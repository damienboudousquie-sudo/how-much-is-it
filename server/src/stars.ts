import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiscoverHit, Mode } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { officialStars } from "./osuApi";

/**
 * Star ratings shown on the map lists. The lists come from a mirror whose star ratings can
 * lag behind osu!'s reworks, so each shown difficulty (with its mods) is replaced by the
 * star rating osu! itself gives, asked once and kept on disk. Bump VERSION after a rework
 * to ask again.
 */
const VERSION = 1;
const FILE = join(repoRoot, "cache", `stars-v${VERSION}.json`);
const RULESET: Record<Mode, string> = { osu: "osu", taiko: "taiko", catch: "fruits", mania: "mania" };
/** Time a list may wait for missing star ratings; the rest arrive on the next view. */
const WAIT_MS = 1500;
const CONCURRENCY = 6;

const known = new Map<string, number>();
const pending = new Map<string, Promise<number | null>>();
let dirty = false;

try {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, number>;
  for (const [key, value] of Object.entries(raw)) if (typeof value === "number") known.set(key, value);
} catch {
  // First run.
}

setInterval(() => {
  if (!dirty) return;
  dirty = false;
  try {
    mkdirSync(join(repoRoot, "cache"), { recursive: true });
  } catch {
    // ignore
  }
  const tmp = `${FILE}.tmp`;
  void writeFile(tmp, JSON.stringify(Object.fromEntries(known)))
    .then(() => rename(tmp, FILE))
    .catch(() => undefined);
}, 30_000).unref?.();

function keyOf(hit: DiscoverHit): string {
  return `${hit.mode}:${hit.beatmapId}:${[...hit.mods].sort().join("")}`;
}

function ask(hit: DiscoverHit): Promise<number | null> {
  const key = keyOf(hit);
  let promise = pending.get(key);
  if (!promise) {
    promise = officialStars(hit.beatmapId, hit.mods, RULESET[hit.mode])
      .then((stars) => {
        if (stars != null) {
          known.set(key, Math.round(stars * 1000) / 1000);
          dirty = true;
        }
        return stars;
      })
      .catch(() => null)
      .finally(() => pending.delete(key));
    pending.set(key, promise);
  }
  return promise;
}

/** Puts osu!'s own star rating on the hits, waiting a little for the ones not known yet. */
export async function withOfficialStars(hits: DiscoverHit[]): Promise<DiscoverHit[]> {
  const missing = hits.filter((hit) => !known.has(keyOf(hit)));
  if (missing.length > 0) {
    const queue = [...missing];
    const work = Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (let hit = queue.shift(); hit; hit = queue.shift()) await ask(hit);
      }),
    );
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, WAIT_MS))]);
  }
  return hits.map((hit) => {
    const stars = known.get(keyOf(hit));
    return stars != null ? { ...hit, stars } : hit;
  });
}
