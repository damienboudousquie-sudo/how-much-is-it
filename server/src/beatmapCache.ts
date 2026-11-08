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

/**
 * Where .osu files come from. osu.ppy.sh slows down heavy users, so downloads rotate
 * between it and two mirrors serving the same files; a source that refuses or fails
 * rests for a while and the others take over.
 */
const SOURCES = [
  (id: number) => `https://osu.ppy.sh/osu/${id}`,
  (id: number) => `https://catboy.best/osu/${id}`,
  (id: number) => `https://osu.direct/api/osu/${id}`,
];
const restUntil = SOURCES.map(() => 0);
const stats = SOURCES.map(() => ({ ok: 0, limited: 0, missing: 0, failed: 0, ms: 0 }));

/** Per-source download counts, for /api/scan. */
export function downloadStats() {
  const now = Date.now();
  return SOURCES.map((source, index) => {
    const entry = stats[index]!;
    return {
      source: new URL(source(1)).host,
      ok: entry.ok,
      limited: entry.limited,
      missing: entry.missing,
      failed: entry.failed,
      averageMs: entry.ok > 0 ? Math.round(entry.ms / entry.ok) : null,
      resting: restUntil[index]! > now,
    };
  });
}
let turn = 0;

function sourceOrder(): number[] {
  const start = turn++ % SOURCES.length;
  const order = SOURCES.map((_, index) => (start + index) % SOURCES.length);
  const now = Date.now();
  return [...order.filter((index) => restUntil[index]! <= now), ...order.filter((index) => restUntil[index]! > now)];
}

async function fetchFrom(index: number, id: number): Promise<Uint8Array | number> {
  const result = await fetchFromSource(index, id);
  const entry = stats[index]!;
  if (typeof result !== "number") entry.ok += 1;
  else if (result === 429) entry.limited += 1;
  else if (result === 404) entry.missing += 1;
  else entry.failed += 1;
  return result;
}

async function fetchFromSource(index: number, id: number): Promise<Uint8Array | number> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(SOURCES[index]!(id), {
      headers: { Accept: "text/plain,*/*", "User-Agent": "osu-pp-lookup/1.0" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });
  } catch {
    restUntil[index] = Date.now() + 15_000;
    return 0;
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after")) || 30;
    restUntil[index] = Date.now() + Math.min(120, retry) * 1000;
    return 429;
  }
  if (!response.ok) {
    if (response.status !== 404) restUntil[index] = Date.now() + 15_000;
    return response.status;
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) return 413;
  // A mirror may answer with a page instead of the file: that counts as missing there.
  if (!looksLikeOsu(decodeOsu(buffer))) return 404;
  stats[index]!.ms += Date.now() - started;
  return buffer;
}

async function download(id: number, store = true): Promise<{ bytes: Uint8Array; text: string }> {
  const statuses: number[] = [];
  let buffer: Uint8Array | null = null;
  for (const index of sourceOrder()) {
    const result = await fetchFrom(index, id);
    if (typeof result !== "number") {
      buffer = result;
      break;
    }
    statuses.push(result);
    // osu.ppy.sh is the reference: if it has no such map, nobody has.
    if (index === 0 && result === 404) break;
  }
  if (!buffer) {
    if (statuses.includes(413)) throw new AppError("unavailable", tr("map.huge"), 502);
    if (statuses.includes(404)) throw new AppError("not_found", tr("map.missing"), 404);
    if (statuses.length > 0 && statuses.every((status) => status === 429)) {
      throw new AppError("rate_limited", tr("search.osuWait", { seconds: 30 }), 429);
    }
    throw new AppError("unavailable", tr("map.download"), 502);
  }
  const text = decodeOsu(buffer);
  if (store) await persist(id, buffer);
  return { bytes: buffer, text };
}

async function persist(id: number, bytes: Uint8Array): Promise<void> {
  try {
    const path = cachePath(id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  } catch {
    // The disk copy only saves a later download.
  }
}

/** .osu files read for pattern analysis, kept so opening one of those maps is instant. */
const recentText = new Lru<{ bytes: Uint8Array; text: string }>(300);

/**
 * The .osu text for pattern analysis. Uses the lookup cache when the map was opened,
 * otherwise downloads without writing to disk, so scanning a range does not fill it.
 */
export async function fetchBeatmapText(id: number): Promise<string> {
  const cached = maps.get(String(id)) ?? recentText.get(String(id));
  if (cached) return cached.text;
  const disk = await readDisk(id);
  if (disk) return disk.text;
  let pending = inflight.get(id);
  if (!pending) {
    pending = download(id, false).finally(() => inflight.delete(id));
    inflight.set(id, pending);
  }
  const file = await pending;
  recentText.set(String(id), file);
  return file.text;
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

  const recent = recentText.get(String(id));
  if (recent) {
    maps.set(String(id), { ...recent, byMode: new Map(), diffs: new Map() });
    void persist(id, recent.bytes);
    return recent;
  }

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
