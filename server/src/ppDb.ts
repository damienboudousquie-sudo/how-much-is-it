import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyStyle, farmHint, modRate, modsInCombo, type ConcreteStyle, type Mode } from "@osu-pp/shared";
import { AppError } from "./errors";
import { repoRoot } from "./env";
import { tr } from "./locale";
import { Lru } from "./lru";

const MIRROR = "https://mirror.hinamizawa.ai";
const MODE_ID: Record<Mode, string> = { osu: "0", taiko: "1", catch: "2", mania: "3" };
/** The mirror caps a page at 200 maps and answers in ~2 s, so fewer, larger pages win. */
const PAGE_SIZE = 200;
/** PP width of one cached slice. A range is the union of the slices it touches. */
export const BAND = 25;
/** Widest range loaded at once, so a 0 to 2000 request does not pull the whole catalogue. */
export const MAX_BANDS = 24;
const MAX_PAGES_PER_BAND = 50;
const TTL_MS = 24 * 60 * 60 * 1000;
const SCHEMA = 3;
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
  /** Drain time as played: the mirror gives it without DT/HT, so it is divided by the clock rate. */
  lengthSeconds: number | null;
  /** BPM and AR as played with the mods (the mirror applies them). */
  bpm: number | null;
  ar: number | null;
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

/* ---------- mirror requests, at most 16 at a time ---------- */

let active = 0;
const waiting: (() => void)[] = [];

async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 16) await new Promise<void>((resolve) => waiting.push(resolve));
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
  const comboMods = typeof row.mods === "string" ? row.mods : mods;
  const rate = modRate(modsInCombo(comboMods));
  return {
    beatmapId,
    beatmapsetId: readId(row.beatmapset_id),
    title,
    artist: readText(row.artist, "Unknown artist"),
    creator,
    version,
    stars,
    pp,
    lengthSeconds: seconds != null && seconds > 0 ? Math.round(seconds / rate) : null,
    bpm,
    ar: readNumber(row.ar),
    mods: comboMods,
    guess: classifyStyle({
      tags,
      version,
      // Density below is nomod, so the BPM must be too.
      bpm: bpm != null ? bpm / rate : null,
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

// A band near 200 pp holds ~6 000 maps (~2 MB in memory); 48 bands fit the 512 MB free plan.
const memory = new Lru<Stored>(48);
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

/**
 * A band fills page by page in the background. Searches read whatever has arrived,
 * so a new range answers in a couple of seconds instead of waiting for every page.
 */
interface Band {
  maps: PpDbMap[];
  total: number | null;
  done: boolean;
  failed: boolean;
  ready: Promise<void>;
}

const bands = new Lru<Band>(48);

function bandParams(mode: Mode, mods: string, low: number, offset: number): string {
  return new URLSearchParams({
    mods,
    game_mode: MODE_ID[mode],
    min_pp: String(low),
    max_pp: String(low + BAND),
    limit: String(PAGE_SIZE),
    offset: String(offset),
  }).toString();
}

function inBand(map: PpDbMap, low: number): boolean {
  // Bands share their edges; keep the low edge only so a map is never counted twice.
  return map.pp >= low && map.pp < low + BAND;
}

function startBand(mode: Mode, mods: string, low: number): Band {
  const key = `band\n${mode}\n${mods}\n${low}`;
  const existing = bands.get(key);
  if (existing && !existing.failed) return existing;
  const band: Band = { maps: [], total: null, done: false, failed: false, ready: Promise.resolve() };
  band.ready = (async () => {
    const disk = memory.get(key) ?? (await readStored(key));
    if (disk) {
      band.maps = disk.maps;
      band.total = disk.maps.length;
      band.done = true;
      return;
    }
    const path = (offset: number) => `/v3/osu/pp-maps?${bandParams(mode, mods, low, offset)}`;
    try {
      const first = await fetchPage(path(0), mods);
      band.maps.push(...first.maps.filter((map) => inBand(map, low)));
      band.total = first.total;
      const pages = Math.min(MAX_PAGES_PER_BAND, Math.max(1, Math.ceil(first.total / PAGE_SIZE)));
      await Promise.all(
        Array.from({ length: pages - 1 }, (_, index) =>
          fetchPage(path((index + 1) * PAGE_SIZE), mods).then((page) => {
            band.maps.push(...page.maps.filter((map) => inBand(map, low)));
          }),
        ),
      );
      band.done = true;
      const stored = { schema: SCHEMA, at: Date.now(), maps: band.maps };
      memory.set(key, stored);
      void writeStored(key, stored);
    } catch {
      // Keep what arrived; the next search starts the band again.
      band.failed = true;
      band.done = true;
    }
  })();
  bands.set(key, band);
  return band;
}

export interface RangeProgress extends RangeLoad {
  /** Maps received so far and expected, while bands are still loading. */
  loaded: number;
  expected: number;
  complete: boolean;
}

/**
 * Every ranked map in a PP window, band by band from the top of the window.
 * Waits at most `waitMs` for the bands, then answers with what has arrived.
 */
export async function loadRangeMaps(
  input: { mode: Mode; mods: string; ppMin: number; ppMax: number },
  waitMs = 2500,
): Promise<RangeProgress> {
  const top = Math.floor(input.ppMax / BAND) * BAND;
  const bottom = Math.floor(input.ppMin / BAND) * BAND;
  const lows: number[] = [];
  for (let low = top; low >= bottom && lows.length < MAX_BANDS; low -= BAND) lows.push(low);
  const lowest = lows[lows.length - 1] ?? bottom;
  const list = lows.map((low) => startBand(input.mode, input.mods, low));

  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all(list.map((band) => band.ready)),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, waitMs);
    }),
  ]);
  clearTimeout(timer);

  if (list.every((band) => band.failed && band.maps.length === 0)) throw new AppError("unavailable", tr("ppdb.down"), 502);
  const maps: PpDbMap[] = [];
  let loaded = 0;
  let expected = 0;
  for (const band of list) {
    loaded += band.maps.length;
    expected += band.done ? band.maps.length : Math.max(band.total ?? PAGE_SIZE, band.maps.length);
    for (const map of band.maps) if (map.pp >= input.ppMin && map.pp <= input.ppMax) maps.push(map);
  }
  return { maps, limitedFrom: lowest > bottom ? lowest : null, loaded, expected, complete: list.every((band) => band.done) };
}

/** Text search across the catalogue. The PP range is then a local filter. */
export function loadTextMaps(input: { query: string; mode: Mode; mods: string }): Promise<PpDbMap[]> {
  const query = input.query.trim().toLowerCase();
  const key = `text\n${input.mode}\n${input.mods}\n${query}`;
  return cached(key, async () => {
    const params = (offset: number) =>
      new URLSearchParams({ q: query, mods: input.mods, game_mode: MODE_ID[input.mode], limit: String(PAGE_SIZE), offset: String(offset) });
    const { maps } = await fetchAll((offset) => `/v3/osu/pp-maps/search?${params(offset)}`, input.mods, 10);
    return maps;
  });
}

export function coverFor(beatmapsetId: number | null, size: "card" | "cover" = "card"): string | null {
  return beatmapsetId ? `https://assets.ppy.sh/beatmaps/${beatmapsetId}/covers/${size}.jpg` : null;
}
