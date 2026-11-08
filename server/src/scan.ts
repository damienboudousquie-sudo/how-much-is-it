import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoRoot } from "./env";
import { analyzeEventually, knownCount, scanBacklog, seedSize } from "./patternStore";
import { fetchCatalogPage } from "./ppDb";

/**
 * Reads every ranked osu! difficulty once, in the background, so every search works on
 * maps whose type is known. Walks the catalogue page by page (highest pp first), keeps
 * the scan lane short, and remembers where it stopped across restarts. Once done, it
 * starts over a day later to pick up newly ranked maps (known maps are skipped).
 *
 * Off with FULL_SCAN=0.
 */

const STATE_FILE = join(repoRoot, "cache", "scan-state.json");
/** Pages are fetched only while fewer maps than this wait in the scan lane. */
const LOW_WATER = 400;
const RESCAN_AFTER_MS = 24 * 3600 * 1000;

interface State {
  offset: number;
  total: number;
  /** When the last full pass ended. */
  finishedAt: number | null;
}

let state: State = { offset: 0, total: 0, finishedAt: null };
let started = false;
let lastError: string | null = null;

function loadState(): void {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<State>;
    state = {
      offset: typeof raw.offset === "number" ? raw.offset : 0,
      total: typeof raw.total === "number" ? raw.total : 0,
      finishedAt: typeof raw.finishedAt === "number" ? raw.finishedAt : null,
    };
  } catch {
    // First run.
  }
}

async function saveState(): Promise<void> {
  try {
    mkdirSync(join(repoRoot, "cache"), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(state));
  } catch {
    // Kept in memory.
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms).unref?.());

async function run(): Promise<void> {
  for (;;) {
    if (state.finishedAt != null) {
      const wait = state.finishedAt + RESCAN_AFTER_MS - Date.now();
      if (wait > 0) await sleep(Math.min(wait, 3600_000));
      if (state.finishedAt + RESCAN_AFTER_MS > Date.now()) continue;
      state = { offset: 0, total: state.total, finishedAt: null };
    }
    if (scanBacklog() >= LOW_WATER) {
      await sleep(1000);
      continue;
    }
    try {
      const page = await fetchCatalogPage(state.offset);
      lastError = null;
      state.total = page.total;
      analyzeEventually(page.ids);
      state.offset += page.ids.length;
      if (page.ids.length === 0 || state.offset >= page.total) state.finishedAt = Date.now();
      await saveState();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(30_000);
    }
  }
}

export function startFullScan(): void {
  if (started || process.env.FULL_SCAN === "0") return;
  started = true;
  loadState();
  void run();
}

export function scanStatus() {
  return {
    enabled: started,
    catalogue: state.total,
    /** Maps whose type is known (read now, or from the seed file). */
    known: knownCount(),
    fromSeed: seedSize(),
    /** Catalogue pages walked in the current pass. */
    walked: state.offset,
    waiting: scanBacklog(),
    finishedAt: state.finishedAt ? new Date(state.finishedAt).toISOString() : null,
    lastError,
  };
}
