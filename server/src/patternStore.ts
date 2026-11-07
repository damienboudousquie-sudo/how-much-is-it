import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PatternProfile } from "@osu-pp/shared";
import { fetchBeatmapText } from "./beatmapCache";
import { repoRoot } from "./env";
import { AppError } from "./errors";
import { analyzePatterns, PATTERN_VERSION } from "./patterns";

/**
 * Pattern profiles, one per beatmap id, kept on disk. A map is read once,
 * then its type is known for every PP range and mod combination.
 */

const DIR = join(repoRoot, "cache");
const FILE = join(DIR, `patterns-v${PATTERN_VERSION}.json`);
const CONCURRENCY = 8;
/** 0 marks a map that cannot be analysed (not osu! standard, too short, gone). */
type Entry = PatternProfile | 0;

let store: Map<number, Entry> | null = null;
let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;
let pausedUntil = 0;

function load(): Map<number, Entry> {
  if (store) return store;
  store = new Map();
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, Entry>;
    for (const [id, entry] of Object.entries(raw)) {
      if (entry === 0 || (entry && entry.v === PATTERN_VERSION)) store.set(Number(id), entry);
    }
  } catch {
    // First run, or an older format: start empty.
  }
  return store;
}

function scheduleSave(): void {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty || !store) return;
    dirty = false;
    const body = JSON.stringify(Object.fromEntries(store));
    void (async () => {
      try {
        mkdirSync(DIR, { recursive: true });
        const temp = `${FILE}.${process.pid}.tmp`;
        await writeFile(temp, body);
        await rename(temp, FILE);
      } catch {
        dirty = true;
      }
    })();
  }, 3000);
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
const urgent: number[] = [];
const background: number[] = [];
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
    // Other failures stay unknown and are retried by a later search.
  }
}

function pump(): void {
  while (running < CONCURRENCY && (urgent.length > 0 || background.length > 0)) {
    if (Date.now() < pausedUntil) {
      setTimeout(pump, pausedUntil - Date.now()).unref?.();
      return;
    }
    const id = urgent.shift() ?? background.shift()!;
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

function enqueue(ids: Iterable<number>, front: boolean): number[] {
  const added: number[] = [];
  for (const id of ids) {
    if (load().has(id)) continue;
    if (queued.has(id)) {
      if (front) {
        const index = background.indexOf(id);
        if (index >= 0) {
          background.splice(index, 1);
          urgent.push(id);
        }
      }
      added.push(id);
      continue;
    }
    queued.add(id);
    (front ? urgent : background).push(id);
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
  enqueue(ids, false);
}

/** Reads maps first in line and waits, at most `budgetMs`. Returns how many are still unknown. */
export async function analyzeNow(ids: Iterable<number>, budgetMs: number, signal?: AbortSignal): Promise<number> {
  const pending = enqueue(ids, true);
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
