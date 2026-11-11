import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyRanges, type DiscoverHit } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { calculatePlay } from "./pp";
import { discover } from "./service";

/**
 * How pp usually splits between aim, speed, accuracy and reading on the farm maps most
 * players have in their top. Aim always weighs the most in osu! pp, so a player's skills
 * only mean something next to this: a streamer has a bigger speed share than usual even
 * when aim is still his largest number. Measured once on a sample of the catalogue and
 * kept on disk; bump VERSION after a pp rework.
 */
export type SkillShares = { aim: number; speed: number; accuracy: number; reading: number };

const VERSION = 1;
const FILE = join(repoRoot, "cache", `skill-base-v${VERSION}.json`);
/** Used until the sample is measured. */
const FALLBACK: SkillShares = { aim: 0.47, speed: 0.27, accuracy: 0.14, reading: 0.12 };
const BANDS: [number, number][] = [
  [250, 400],
  [400, 550],
  [550, 750],
  [750, 1200],
];
const PER_BAND = 70;

let measured: SkillShares | null = null;
try {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as { shares?: SkillShares };
  if (raw.shares && raw.shares.aim > 0) measured = raw.shares;
} catch {
  // First run.
}

let running: Promise<SkillShares | null> | null = null;

export function sharesOf(parts: SkillShares): SkillShares | null {
  const total = parts.aim + parts.speed + parts.accuracy + parts.reading;
  if (!(total > 0)) return null;
  return { aim: parts.aim / total, speed: parts.speed / total, accuracy: parts.accuracy / total, reading: parts.reading / total };
}

async function measure(): Promise<SkillShares | null> {
  const hits: DiscoverHit[] = [];
  for (const [min, max] of BANDS) {
    let offset = 0;
    const band: DiscoverHit[] = [];
    for (let page = 0; page < 3 && band.length < PER_BAND; page++) {
      const answer = await discover({
        query: "",
        mode: "osu",
        styles: [],
        mods: { EZ: "off", HD: "any", HR: "any", DT: "any", HT: "off", FL: "off" },
        ppMin: min,
        ppMax: max,
        offset,
        sort: [{ key: "farm", dir: "desc" }],
        ranges: emptyRanges(),
      });
      band.push(...answer.results);
      if (!answer.hasMore) break;
      offset += answer.results.length;
    }
    hits.push(...band.slice(0, PER_BAND));
  }
  const sum: SkillShares = { aim: 0, speed: 0, accuracy: 0, reading: 0 };
  let count = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < hits.length) {
        const hit = hits[next++];
        try {
          const result = await calculatePlay(
            { beatmapId: hit.beatmapId, mode: "osu", mods: [...hit.mods], clockRate: null, accuracy: 99, combo: null, misses: 0 },
            "osu",
            0,
            true,
          );
          const s = result.score;
          const shares = sharesOf({ aim: s.aim ?? 0, speed: s.speed ?? 0, accuracy: s.accuracyPp ?? 0, reading: s.reading ?? 0 });
          if (!shares) continue;
          sum.aim += shares.aim;
          sum.speed += shares.speed;
          sum.accuracy += shares.accuracy;
          sum.reading += shares.reading;
          count++;
        } catch {
          // Skip a map that fails.
        }
      }
    }),
  );
  if (count < 40) return null;
  const shares: SkillShares = { aim: sum.aim / count, speed: sum.speed / count, accuracy: sum.accuracy / count, reading: sum.reading / count };
  try {
    mkdirSync(join(repoRoot, "cache"), { recursive: true });
    await writeFile(FILE, JSON.stringify({ at: new Date().toISOString(), maps: count, shares }));
  } catch {
    // Measured again after a restart.
  }
  return shares;
}

/** The usual split, waiting at most `waitMs` for the first measurement. */
export async function skillBase(waitMs = 8000): Promise<{ shares: SkillShares; measured: boolean }> {
  if (measured) return { shares: measured, measured: true };
  running ??= measure()
    .then((value) => {
      measured = value;
      return value;
    })
    .catch(() => null)
    .finally(() => {
      running = null;
    });
  const value = await Promise.race([running, new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))]);
  return value ? { shares: value, measured: true } : { shares: FALLBACK, measured: false };
}
