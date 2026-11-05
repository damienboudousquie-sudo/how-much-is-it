import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mode } from "@osu-pp/shared";
import { AppError } from "./errors";
import { repoRoot } from "./env";
import { tr } from "./locale";

const MIRROR = "https://mirror.hinamizawa.ai";
const MODE_ID: Record<Mode, string> = { osu: "0", taiko: "1", catch: "2", mania: "3" };

export interface PpDbMap {
  beatmapId: number;
  beatmapsetId: number | null;
  title: string;
  artist: string;
  creator: string;
  version: string;
  cover: string | null;
  stars: number;
  pp: number;
  lengthSeconds: number | null;
  mods: string;
}

export interface PpDbPage {
  maps: PpDbMap[];
  total: number;
  hasMore: boolean;
}

function readSeconds(row: Record<string, unknown>): number | null {
  const value = row.drain_time_seconds ?? row.hit_length ?? row.total_length;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function readId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

async function fetchPpPage(path: string, mods: string, offset: number, signal?: AbortSignal): Promise<PpDbPage> {
  const timeout = AbortSignal.timeout(12_000);
  const signals = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${MIRROR}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "osu-pp-lookup/0.1 (+local)" },
      signal: signals,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AppError("unavailable", tr("ppdb.down"), 502);
  }
  if (!response.ok) throw new AppError("unavailable", tr("ppdb.down"), 502);
  const json = (await response.json()) as { maps?: unknown; total?: unknown };
  if (!Array.isArray(json.maps)) throw new AppError("unavailable", tr("ppdb.down"), 502);
  const maps: PpDbMap[] = [];
  for (const item of json.maps) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const beatmapId = readId(row.beatmap_id);
    if (beatmapId == null || typeof row.pp !== "number" || typeof row.stars !== "number") continue;
    const cover = typeof row.cover === "string" && row.cover.startsWith("https://") ? row.cover : null;
    maps.push({
      beatmapId,
      beatmapsetId: readId(row.beatmapset_id),
      title: typeof row.title === "string" ? row.title : "Untitled",
      artist: typeof row.artist === "string" ? row.artist : "Unknown artist",
      creator: typeof row.creator === "string" ? row.creator : "Unknown creator",
      version: typeof row.version === "string" ? row.version : "Difficulty",
      cover,
      stars: row.stars,
      pp: row.pp,
      lengthSeconds: readSeconds(row),
      mods: typeof row.mods === "string" ? row.mods : mods,
    });
  }
  const total = typeof json.total === "number" ? json.total : offset + maps.length;
  return { maps, total, hasMore: offset + maps.length < total };
}

export async function searchPpMaps(
  input: { mode: Mode; mods: string; ppMin: number; ppMax: number; limit: number; offset: number },
  signal?: AbortSignal,
): Promise<PpDbPage> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit)));
  const offset = Math.max(0, Math.floor(input.offset));
  const params = new URLSearchParams({
    mods: input.mods,
    game_mode: MODE_ID[input.mode],
    min_pp: String(input.ppMin),
    max_pp: String(input.ppMax),
    limit: String(limit),
    offset: String(offset),
  });
  return fetchPpPage(`/v3/osu/pp-maps?${params}`, input.mods, offset, signal);
}

export async function searchPpText(
  input: { query: string; mode: Mode; mods: string; limit: number; offset: number },
  signal?: AbortSignal,
): Promise<PpDbPage> {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit)));
  const offset = Math.max(0, Math.floor(input.offset));
  const params = new URLSearchParams({
    q: input.query,
    mods: input.mods,
    game_mode: MODE_ID[input.mode],
    limit: String(limit),
    offset: String(offset),
  });
  return fetchPpPage(`/v3/osu/pp-maps/search?${params}`, input.mods, offset, signal);
}

const INDEX_TTL_MS = 12 * 60 * 60 * 1000;
const INDEX_DIR = join(repoRoot, "cache", "pp-index");

interface StoredIndex {
  at: number;
  maps: PpDbMap[];
}

const memoryIndex = new Map<string, StoredIndex>();
const indexInflight = new Map<string, Promise<PpDbMap[]>>();

function indexKey(query: string, mode: Mode, mods: string): string {
  return `${mode}\n${mods}\n${query}`;
}

function indexPath(key: string): string {
  return join(INDEX_DIR, `${createHash("sha1").update(key).digest("hex")}.json`);
}

async function readIndex(key: string): Promise<StoredIndex | null> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(key), "utf8")) as StoredIndex;
    if (!parsed || !Array.isArray(parsed.maps) || Date.now() - parsed.at > INDEX_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function fetchAllText(input: { query: string; mode: Mode; mods: string }): Promise<PpDbMap[]> {
  const size = 100;
  const first = await searchPpText({ ...input, limit: size, offset: 0 });
  const pages = Math.min(20, Math.max(1, Math.ceil(first.total / size)));
  const rest =
    pages === 1
      ? []
      : await Promise.all(
          Array.from({ length: pages - 1 }, (_, index) => searchPpText({ ...input, limit: size, offset: (index + 1) * size })),
        );
  return first.maps.concat(...rest.map((page) => page.maps));
}

/** Full text catalogue, kept in memory and on disk so a PP range is a local filter. */
export async function loadTextMaps(input: { query: string; mode: Mode; mods: string }): Promise<PpDbMap[]> {
  const key = indexKey(input.query, input.mode, input.mods);
  const cached = memoryIndex.get(key);
  if (cached && Date.now() - cached.at < INDEX_TTL_MS) return cached.maps;
  const pending = indexInflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const disk = await readIndex(key);
    if (disk) {
      memoryIndex.set(key, disk);
      return disk.maps;
    }
    const maps = await fetchAllText(input);
    const stored = { at: Date.now(), maps };
    memoryIndex.set(key, stored);
    await mkdir(INDEX_DIR, { recursive: true });
    await writeFile(indexPath(key), JSON.stringify(stored)).catch(() => undefined);
    return maps;
  })().finally(() => indexInflight.delete(key));
  indexInflight.set(key, job);
  return job;
}
