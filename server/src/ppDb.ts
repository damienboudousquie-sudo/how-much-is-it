import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyStyle, farmHint, type ConcreteStyle, type Mode } from "@osu-pp/shared";
import { AppError } from "./errors";
import { repoRoot } from "./env";
import { tr } from "./locale";
import { Lru } from "./lru";

const MIRROR = "https://mirror.hinamizawa.ai";
const MODE_ID: Record<Mode, string> = { osu: "0", taiko: "1", catch: "2", mania: "3" };
const PAGE_SIZE = 100;
/** PP width of one cached slice. A range is the union of the slices it touches. */
export const BAND = 25;
/** Widest range loaded at once, so a 0 to 2000 request does not pull the whole catalogue. */
export const MAX_BANDS = 24;
const MAX_PAGES_PER_BAND = 80;
const TTL_MS = 24 * 60 * 60 * 1000;
const SCHEMA = 2;
const DIR = join(repoRoot, "cache", "pp-bands");

export interface PpDbMap {
  beatmapId: number;
  beatmapsetId: number | null;
  title: string;
  artist: string;
  creator: string;
  version: string;
  stars: number;
  pp: number;
  lengthSeconds: number | null;
  bpm: number | null;
  mods: string;
  /** Type guessed from tags, name and density, before the .osu file is read. */
  guess: ConcreteStyle | null;
  /** 0 to 1, see farmHint. */
  hint: number;
}

export interface RangeLoad {
  maps: PpDbMap[];
  /** Lowest PP actually loaded when the range was wider than MAX_BANDS. */
  limitedFrom: number | null;
}

/* ---------- mirror requests, at most 8 at a time ---------- */

let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 8) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await job();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readId(value: unknown): number | null {
  const id = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

function readText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readTags(value: unknown): string {
  if (Array.isArray(value)) return value.filter((tag): tag is string => typeof tag === "string").join(" ");
  return typeof value === "string" ? value : "";
}

function toMap(row: Record<string, unknown>, mods: string): PpDbMap | null {
  const beatmapId = readId(row.beatmap_id);
  const pp = readNumber(row.pp);
  const stars = readNumber(row.stars);
  if (beatmapId == null || pp == null || stars == null) return null;
  const seconds = readNumber(row.drain_time_seconds ?? row.hit_length ?? row.total_length);
  const objects = readNumber(row.total_objects);
  const drain = readNumber(row.drain_time_seconds);
  const circles = readNumber(row.count_circles);
  const bpm = readNumber(row.bpm);
  const title = readText(row.title, "Untitled");
  const creator = readText(row.creator, "Unknown creator");
  const version = readText(row.version, "Difficulty");
  const tags = readTags(row.tags);
  return {
    beatmapId,
    beatmapsetId: readId(row.beatmapset_id),
    title,
    artist: readText(row.artist, "Unknown artist"),
    creator,
    version,
    stars,
    pp,
    lengthSeconds: seconds != null && seconds > 0 ? seconds : null,
    bpm,
    mods: typeof row.mods === "string" ? row.mods : mods,
    guess: classifyStyle({
      tags,
      version,
      bpm,
      stars,
      density: objects != null && drain != null && drain > 0 ? objects / drain : null,
      circleRatio: objects != null && circles != null && objects > 0 ? circles / objects : null,
    }),
    hint: farmHint({ title, creator, tags }),
  };
}

async function fetchPage(path: string, mods: string, signal?: AbortSignal): Promise<{ maps: PpDbMap[]; total: number }> {
  return slot(async () => {
    const timeout = AbortSignal.timeout(15_000);
    const signals = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetch(`${MIRROR}${path}`, {
        headers: { Accept: "application/json", "User-Agent": "osu-pp-lookup/0.2 (+local)" },
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
      const map = toMap(item as Record<string, unknown>, mods);
      if (map) maps.push(map);
    }
    return { maps, total: typeof json.total === "number" ? json.total : maps.length };
  });
}

async function fetchAll(pathFor: (offset: number) => string, mods: string, maxPages: number): Promise<{ maps: PpDbMap[]; complete: boolean }> {
  const first = await fetchPage(pathFor(0), mods);
  const pages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
  const wanted = Math.min(maxPages, pages);
  const rest = await Promise.all(
    Array.from({ length: wanted - 1 }, (_, index) => fetchPage(pathFor((index + 1) * PAGE_SIZE), mods).then((page) => page.maps)),
  );
  return { maps: first.maps.concat(...rest), complete: wanted === pages };
}

/* ---------- cache: memory LRU over disk files ---------- */

interface Stored {
  schema: number;
  at: number;
  maps: PpDbMap[];
}

const memory = new Lru<Stored>(160);
const inflight = new Map<string, Promise<PpDbMap[]>>();

function fileFor(key: string): string {
  return join(DIR, `${createHash("sha1").update(key).digest("hex")}.json`);
}

async function readStored(key: string): Promise<Stored | null> {
  try {
    const parsed = JSON.parse(await readFile(fileFor(key), "utf8")) as Stored;
    if (parsed?.schema !== SCHEMA || !Array.isArray(parsed.maps) || Date.now() - parsed.at > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeStored(key: string, stored: Stored): Promise<void> {
  try {
    await mkdir(DIR, { recursive: true });
    const path = fileFor(key);
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(stored));
    await rename(temp, path);
  } catch {
    // The cache is an optimisation. A failed write only costs a refetch.
  }
}

function cached(key: string, load: () => Promise<PpDbMap[]>): Promise<PpDbMap[]> {
  const hit = memory.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.maps);
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (async () => {
    const disk = await readStored(key);
    if (disk) {
      memory.set(key, disk);
      return disk.maps;
    }
    const maps = await load();
    const stored = { schema: SCHEMA, at: Date.now(), maps };
    memory.set(key, stored);
    void writeStored(key, stored);
    return maps;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

function loadBand(mode: Mode, mods: string, low: number): Promise<PpDbMap[]> {
  const key = `band\n${mode}\n${mods}\n${low}`;
  return cached(key, async () => {
    const params = (offset: number) =>
      new URLSearchParams({
        mods,
        game_mode: MODE_ID[mode],
        min_pp: String(low),
        max_pp: String(low + BAND),
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
    const { maps } = await fetchAll((offset) => `/v3/osu/pp-maps?${params(offset)}`, mods, MAX_PAGES_PER_BAND);
    // Bands share their edges; keep the low edge only so a map is never counted twice.
    return maps.filter((map) => map.pp >= low && map.pp < low + BAND);
  });
}

/** Every ranked map in a PP window, loaded band by band from the top of the window. */
export async function loadRangeMaps(input: { mode: Mode; mods: string; ppMin: number; ppMax: number }): Promise<RangeLoad> {
  const top = Math.floor(input.ppMax / BAND) * BAND;
  const bottom = Math.floor(input.ppMin / BAND) * BAND;
  const bands: number[] = [];
  for (let low = top; low >= bottom && bands.length < MAX_BANDS; low -= BAND) bands.push(low);
  const lowest = bands[bands.length - 1] ?? bottom;
  const lists = await Promise.all(bands.map((low) => loadBand(input.mode, input.mods, low)));
  const maps: PpDbMap[] = [];
  for (const list of lists) {
    for (const map of list) if (map.pp >= input.ppMin && map.pp <= input.ppMax) maps.push(map);
  }
  return { maps, limitedFrom: lowest > bottom ? lowest : null };
}

/** Text search across the catalogue. The PP range is then a local filter. */
export function loadTextMaps(input: { query: string; mode: Mode; mods: string }): Promise<PpDbMap[]> {
  const query = input.query.trim().toLowerCase();
  const key = `text\n${input.mode}\n${input.mods}\n${query}`;
  return cached(key, async () => {
    const params = (offset: number) =>
      new URLSearchParams({ q: query, mods: input.mods, game_mode: MODE_ID[input.mode], limit: String(PAGE_SIZE), offset: String(offset) });
    const { maps } = await fetchAll((offset) => `/v3/osu/pp-maps/search?${params(offset)}`, input.mods, 20);
    return maps;
  });
}

export function coverFor(beatmapsetId: number | null, size: "card" | "cover" = "card"): string | null {
  return beatmapsetId ? `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/${size}.jpg` : null;
}
