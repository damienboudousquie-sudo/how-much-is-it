import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Beatmap, type DifficultyAttributes, GameMode } from "rosu-pp-js";
import type { Mode } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { AppError } from "./errors";
import { tr } from "./locale";
import { Lru } from "./lru";
import { decodeOsu, looksLikeOsu } from "./osuFile";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_DIFFS = 8;

interface StoredMap {
  bytes: Uint8Array;
  text: string;
  byMode: Map<Mode, Beatmap>;
  diffs: Map<string, DifficultyAttributes>;
}

const maps = new Lru<StoredMap>(48, (entry) => {
  for (const diff of entry.diffs.values()) diff.free();
  for (const map of entry.byMode.values()) map.free();
});

const inflight = new Map<number, Promise<{ bytes: Uint8Array; text: string }>>();

function cachePath(id: number): string {
  return join(repoRoot, "cache", "osu", `${id}.osu`);
}

function toGameMode(mode: Mode): GameMode {
  switch (mode) {
    case "osu":
      return GameMode.Osu;
    case "taiko":
      return GameMode.Taiko;
    case "catch":
      return GameMode.Catch;
    case "mania":
      return GameMode.Mania;
  }
}

export function gameModeToMode(mode: GameMode): Mode {
  switch (mode) {
    case GameMode.Taiko:
      return "taiko";
    case GameMode.Catch:
      return "catch";
    case GameMode.Mania:
      return "mania";
    default:
      return "osu";
  }
}

async function readDisk(id: number): Promise<{ bytes: Uint8Array; text: string } | null> {
  try {
    const bytes = new Uint8Array(await readFile(cachePath(id)));
    const text = decodeOsu(bytes);
    if (!looksLikeOsu(text)) {
      await rm(cachePath(id), { force: true });
      return null;
    }
    return { bytes, text };
  } catch {
    return null;
  }
}

async function download(id: number, store = true): Promise<{ bytes: Uint8Array; text: string }> {
  let response: Response;
  try {
    response = await fetch(`https://osu.ppy.sh/osu/${id}`, {
      headers: {
        Accept: "text/plain,*/*",
        "User-Agent": "osu-pp-lookup/1.0",
      },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
  } catch {
    throw new AppError("unavailable", tr("map.download"), 502);
  }

  if (response.status === 404) {
    throw new AppError("not_found", tr("map.missing"), 404);
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after")) || 2;
    throw new AppError("rate_limited", tr("search.osuWait", { seconds: retry }), 429);
  }
  if (!response.ok) {
    throw new AppError("unavailable", tr("map.download"), 502);
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new AppError("unavailable", tr("map.huge"), 502);
  }
  const text = decodeOsu(buffer);
  if (!looksLikeOsu(text)) {
    throw new AppError("not_found", tr("map.missing"), 404);
  }

  if (store) {
    const path = cachePath(id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
  }
  return { bytes: buffer, text };
}

/**
 * The .osu text for pattern analysis. Uses the lookup cache when the map was opened,
 * otherwise downloads without keeping the file, so scanning a range does not fill the disk.
 */
export async function fetchBeatmapText(id: number): Promise<string> {
  const cached = maps.get(String(id));
  if (cached) return cached.text;
  const disk = await readDisk(id);
  if (disk) return disk.text;
  const pending = inflight.get(id);
  if (pending) return (await pending).text;
  return (await download(id, false)).text;
}

export function primeBeatmap(id: number, bytes: Uint8Array): void {
  maps.set(String(id), {
    bytes,
    text: decodeOsu(bytes),
    byMode: new Map(),
    diffs: new Map(),
  });
}

export async function loadBeatmapFile(id: number): Promise<{ bytes: Uint8Array; text: string }> {
  const cached = maps.get(String(id));
  if (cached) return { bytes: cached.bytes, text: cached.text };

  const disk = await readDisk(id);
  if (disk) {
    maps.set(String(id), { ...disk, byMode: new Map(), diffs: new Map() });
    return disk;
  }

  let pending = inflight.get(id);
  if (!pending) {
    pending = download(id).finally(() => inflight.delete(id));
    inflight.set(id, pending);
  }
  const file = await pending;
  if (!maps.get(String(id))) {
    maps.set(String(id), { ...file, byMode: new Map(), diffs: new Map() });
  }
  return file;
}

export function openBeatmap(id: number, mode: Mode): Beatmap {
  const entry = maps.get(String(id));
  if (!entry) {
    throw new AppError("unavailable", tr("map.cache"), 502);
  }
  const existing = entry.byMode.get(mode);
  if (existing) return existing;

  const map = new Beatmap(entry.bytes);
  if (map.isSuspicious()) {
    map.free();
    throw new AppError("suspicious", tr("map.suspicious"), 422);
  }

  if (gameModeToMode(map.mode) !== mode) {
    try {
      map.convert(toGameMode(mode));
    } catch {
      map.free();
      throw new AppError("invalid", tr("map.convert"), 400);
    }
  }

  entry.byMode.set(mode, map);
  return map;
}

export function getDifficulty(
  id: number,
  key: string,
  create: () => DifficultyAttributes,
): DifficultyAttributes {
  const entry = maps.get(String(id));
  if (!entry) throw new AppError("unavailable", tr("map.cache"), 502);

  const cached = entry.diffs.get(key);
  if (cached) {
    entry.diffs.delete(key);
    entry.diffs.set(key, cached);
    return cached;
  }

  const created = create();
  entry.diffs.set(key, created);
  while (entry.diffs.size > MAX_DIFFS) {
    const oldest = entry.diffs.keys().next().value;
    if (oldest === undefined) break;
    entry.diffs.get(oldest)?.free();
    entry.diffs.delete(oldest);
  }
  return created;
}
