import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync, gzip } from "node:zlib";
import { promisify } from "node:util";
import type { PatternProfile } from "@osu-pp/shared";
import { fetchBeatmapText } from "./beatmapCache";
import { repoRoot } from "./env";
import { AppError } from "./errors";
import { analyzePatterns, PATTERN_VERSION } from "./patterns";

/**
 * Pattern profiles, one per beatmap id. A map is read once, then its type is known for
 * every PP range and mod combination.
 *
 * Two files:
 * - data/patterns-seed.json.gz, shipped with the code: the whole ranked catalogue read
 *   ahead of time, so a fresh server knows every map from the first search;
 * - cache/patterns-v3.json.gz, written as maps are read, on top of the seed.
 * Both use the compact format of `encode`.
 */

const DIR = join(repoRoot, "cache");
const FILE = join(DIR, `patterns-v${PATTERN_VERSION}.json.gz`);
/** Before the compact format: plain JSON, still read once to migrate. */
const OLD_FILE = join(DIR, `patterns-v${PATTERN_VERSION}.json`);
export const SEED_FILE = join(repoRoot, "data", "patterns-seed.json.gz");
const CONCURRENCY = Number(process.env.ANALYSIS_CONCURRENCY) || 8;
/** 0 marks a map that cannot be analysed (not osu! standard, too short, gone). */
type Entry = PatternProfile | 0;

const gzipAsync = promisify(gzip);

/** Field order of the compact rows: [id, ...values] or [id, 0]. */
const FIELDS = [
  "objects", "bpm", "streamShare", "burstShare", "doubleShare", "longestStream", "streamSpacing", "jumpShare",
  "jumpSpacing", "speedShare", "sliderShare", "irregularShare", "rhythmEntropy", "svChanges", "drain",
] as const satisfies readonly (keyof PatternProfile)[];

interface Packed {
  v: number;
  fields: readonly string[];
  rows: (number[] | [number, 0])[];
}

function encode(entries: Iterable<[number, Entry]>): Packed {
  const rows: Packed["rows"] = [];
  for (const [id, entry] of entries) rows.push(entry === 0 ? [id, 0] : [id, ...FIELDS.map((field) => entry[field])]);
  return { v: PATTERN_VERSION, fields: FIELDS, rows };
}

function decodeInto(target: Map<number, Entry>, packed: Packed): number {
  if (packed.v !== PATTERN_VERSION || !Array.isArray(packed.rows) || !Array.isArray(packed.fields)) return 0;
  const fields = packed.fields as (keyof PatternProfile)[];
  let count = 0;
  for (const row of packed.rows) {
    const id = row[0];
    if (typeof id !== "number") continue;
    if (row.length === 2 && row[1] === 0) {
      target.set(id, 0);
    } else {
      const profile = { v: PATTERN_VERSION } as PatternProfile;
      fields.forEach((field, index) => {
        (profile as unknown as Record<string, number>)[field] = row[index + 1] ?? 0;
      });
      target.set(id, profile);
    }
    count += 1;
  }
  return count;
}

function readPacked(file: string): Packed | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Packed;
  } catch {
    return null;
  }
}

let store: Map<number, Entry> | null = null;
let seeded = 0;
let dirty = false;
let saving = false;
let saveTimer: NodeJS.Timeout | null = null;
let pausedUntil = 0;

function load(): Map<number, Entry> {
  if (store) return store;
  store = new Map();
  const seed = readPacked(SEED_FILE);
  if (seed) seeded = decodeInto(store, seed);
  const own = readPacked(FILE);
  if (own) decodeInto(store, own);
  else {
    try {
      const raw = JSON.parse(readFileSync(OLD_FILE, "utf8")) as Record<string, Entry>;
      for (const [id, entry] of Object.entries(raw)) {
        if (entry === 0 || (entry && entry.v === PATTERN_VERSION)) store.set(Number(id), entry);
      }
      dirty = true;
    } catch {
      // First run.
    }
  }
  return store;
}

/** Profiles known at startup from the seed file, for the status page. */
export function seedSize(): number {
  load();
  return seeded;
}

export function knownCount(): number {
  return load().size;
}

/** The whole store, compact and gzipped: what goes into data/patterns-seed.json.gz. */
export async function exportPacked(): Promise<Buffer> {
  return gzipAsync(JSON.stringify(encode(load())), { level: 9 });
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer || saving) return;
  // The whole catalogue is about 150 000 maps: write in batches, not after every map.
  const delay = load().size > 20_000 ? 30_000 : 3000;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty || !store) return;
    dirty = false;
    saving = true;
    void (async () => {
      try {
        mkdirSync(DIR, { recursive: true });
        const body = await gzipAsync(JSON.stringify(encode(store!)));
        const temp = `${FILE}.${process.pid}.tmp`;
        await writeFile(temp, body);
        await rename(temp, FILE);
      } catch {
        dirty = true;
      } finally {
        saving = false;
        if (dirty) scheduleSave();
      }
    })();
  }, delay);
  saveTimer.unref?.();
}

export function getProfile(id: number): PatternProfile | null | undefined {
  const entry = load().get(id);
  if (entry === undefined) return undefined;
  return entry === 0 ? null : entry;
}

/** Stores a profile measured from a file that is already loaded (a lookup). */
export function rememberProfile(id: number, text: string): PatternProfile | null {
  const known = getProfile(id);
  if (known !== undefined) return known;
  const profile = analyzePatterns(text);
  load().set(id, profile ?? 0);
  scheduleSave();
  return profile;
}

/* ---------- analysis queue ---------- */

const queued = new Set<number>();
/** What a search waits for. */
const urgent: number[] = [];
/** What searches will soon need. */
const background: number[] = [];
/** The full catalogue scan: only when nothing else is waiting. */
const scan: number[] = [];
const listeners = new Map<number, (() => void)[]>();
let running = 0;

function settle(id: number): void {
  queued.delete(id);
  for (const done of listeners.get(id) ?? []) done();
  listeners.delete(id);
}

async function analyzeOne(id: number): Promise<void> {
  try {
    const text = await fetchBeatmapText(id);
    load().set(id, analyzePatterns(text) ?? 0);
    scheduleSave();
  } catch (error) {
    if (error instanceof AppError && error.code === "rate_limited") pausedUntil = Date.now() + 8000;
    else if (error instanceof AppError && error.code === "not_found") {
      load().set(id, 0);
      scheduleSave();
    }
    // Other failures stay unknown and are retried later.
  }
}

function next(): number | undefined {
  // The scan leaves room for searches: it never takes the last two slots.
  if (urgent.length > 0) return urgent.shift();
  if (background.length > 0) return background.shift();
  if (scan.length > 0 && running < CONCURRENCY - 2) return scan.shift();
  return undefined;
}

function pump(): void {
  while (running < CONCURRENCY) {
    if (Date.now() < pausedUntil) {
      setTimeout(pump, pausedUntil - Date.now()).unref?.();
      return;
    }
    const id = next();
    if (id === undefined) return;
    if (load().has(id)) {
      settle(id);
      continue;
    }
    running += 1;
    void analyzeOne(id).finally(() => {
      running -= 1;
      settle(id);
      pump();
    });
  }
}

type Lane = "urgent" | "background" | "scan";

function enqueue(ids: Iterable<number>, lane: Lane): number[] {
  const added: number[] = [];
  for (const id of ids) {
    if (load().has(id)) continue;
    if (queued.has(id)) {
      if (lane === "urgent") {
        for (const list of [background, scan]) {
          const index = list.indexOf(id);
          if (index >= 0) {
            list.splice(index, 1);
            urgent.push(id);
          }
        }
      }
      added.push(id);
      continue;
    }
    queued.add(id);
    (lane === "urgent" ? urgent : lane === "background" ? background : scan).push(id);
    added.push(id);
  }
  // Keep the background queue bounded: newer searches matter more than old ones.
  if (background.length > 1500) {
    for (const id of background.splice(0, background.length - 1500)) settle(id);
  }
  pump();
  return added;
}

/** Reads maps in the background so the next searches are exact. */
export function analyzeLater(ids: Iterable<number>): void {
  enqueue(ids, "background");
}

/** Feeds the full catalogue scan. Returns how many of these maps are still to read. */
export function analyzeEventually(ids: Iterable<number>): number {
  return enqueue(ids, "scan").length;
}

/** Maps waiting in the scan lane. */
export function scanBacklog(): number {
  return scan.length;
}

/** Reads maps first in line and waits, at most `budgetMs`. Returns how many are still unknown. */
export async function analyzeNow(ids: Iterable<number>, budgetMs: number, signal?: AbortSignal): Promise<number> {
  const pending = enqueue(ids, "urgent");
  if (pending.length === 0) return 0;
  const all = Promise.all(
    pending.map(
      (id) =>
        new Promise<void>((resolve) => {
          if (!queued.has(id)) return resolve();
          const list = listeners.get(id) ?? [];
          list.push(resolve);
          listeners.set(id, list);
        }),
    ),
  );
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budgetMs);
  });
  const aborted = new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
  await Promise.race([all, timeout, aborted]);
  clearTimeout(timer);
  return pending.filter((id) => !load().has(id)).length;
}
