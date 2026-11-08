import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./env";

/**
 * How much each difficulty is played, kept on disk. The pp catalogue has no play counts,
 * so they come from the beatmap mirror, one set at a time, for the maps people look at.
 * Used as a small, hidden part of the farm score: well-known farm maps rise a little.
 */

const DIR = join(repoRoot, "cache");
const FILE = join(DIR, "popularity-v1.json");
/** Play counts move slowly; a month-old count is still good for ranking. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const CONCURRENCY = 4;

interface Stored {
  at: number;
  /** beatmap id -> plays */
  plays: Record<string, number>;
  /** set ids already read, with the time they were read */
  sets: Record<string, number>;
}

let plays: Map<number, number> | null = null;
let sets = new Map<number, number>();
let saveTimer: NodeJS.Timeout | null = null;

function load(): Map<number, number> {
  if (plays) return plays;
  plays = new Map();
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as Stored;
    for (const [id, count] of Object.entries(raw.plays ?? {})) plays.set(Number(id), count);
    const now = Date.now();
    for (const [id, at] of Object.entries(raw.sets ?? {})) if (now - at < MAX_AGE_MS) sets.set(Number(id), at);
  } catch {
    // First run.
  }
  return plays;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const body: Stored = { at: Date.now(), plays: Object.fromEntries(load()), sets: Object.fromEntries(sets) };
    void (async () => {
      try {
        mkdirSync(DIR, { recursive: true });
        const temp = `${FILE}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(body));
        await rename(temp, FILE);
      } catch {
        // Kept in memory; saved with the next change.
      }
    })();
  }, 5000);
  saveTimer.unref?.();
}

/** Called for every set the mirror returns, whatever asked for it. */
export function recordPlays(setId: number, beatmaps: readonly { id: number; playcount: number | null }[]): void {
  const store = load();
  let any = false;
  for (const beatmap of beatmaps) {
    if (beatmap.playcount == null) continue;
    store.set(beatmap.id, beatmap.playcount);
    any = true;
  }
  if (!any) return;
  sets.set(setId, Date.now());
  scheduleSave();
}

export function playsOf(beatmapId: number): number | undefined {
  return load().get(beatmapId);
}

/**
 * 0 to 1 on a log scale: 10k plays or fewer is 0, 10M or more is 1.
 * Unknown maps are left out (null) so they are neither pushed up nor down.
 */
export function popularityOf(beatmapId: number): number | null {
  const count = playsOf(beatmapId);
  if (count == null) return null;
  const value = (Math.log10(Math.max(1, count)) - 4) / 3;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/* ---------- reading sets in the background ---------- */

type Fetcher = (setId: number) => Promise<unknown>;

let fetcher: Fetcher | null = null;
const queued = new Set<number>();
const queue: number[] = [];
/** Sets that failed recently, so a mirror outage does not keep the client waiting. */
const failedAt = new Map<number, number>();
let running = 0;
let pausedUntil = 0;

export function setPopularityFetcher(fetch: Fetcher): void {
  fetcher = fetch;
}

function known(setId: number): boolean {
  load();
  const at = sets.get(setId);
  if (at != null && Date.now() - at < MAX_AGE_MS) return true;
  const failed = failedAt.get(setId);
  return failed != null && Date.now() - failed < 10 * 60 * 1000;
}

function pump(): void {
  while (fetcher && running < CONCURRENCY && queue.length > 0) {
    if (Date.now() < pausedUntil) {
      setTimeout(pump, pausedUntil - Date.now()).unref?.();
      return;
    }
    const setId = queue.shift()!;
    queued.delete(setId);
    if (known(setId)) continue;
    running += 1;
    void fetcher(setId)
      .catch((error: unknown) => {
        failedAt.set(setId, Date.now());
        if (error && typeof error === "object" && "code" in error && error.code === "rate_limited") pausedUntil = Date.now() + 10_000;
      })
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

/** Queues sets whose play counts are missing. Returns how many of them are still unknown. */
export function readPopularity(setIds: Iterable<number>): number {
  let missing = 0;
  for (const setId of setIds) {
    if (!setId || known(setId)) continue;
    missing += 1;
    if (queued.has(setId)) continue;
    queued.add(setId);
    queue.push(setId);
  }
  if (queue.length > 1000) for (const id of queue.splice(0, queue.length - 1000)) queued.delete(id);
  pump();
  return missing;
}
