import { mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyRanges, modRate, PROFILE_SKILLS, styleScores, type DiscoverHit, type PatternProfile, type ProfileSkill } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { getProfile } from "./patternStore";
import { calculatePlay } from "./pp";
import { discover } from "./service";

/**
 * The player card's skills, each measured on one play, and the same measures averaged on
 * the farm maps most players have in their top. A skill only means something next to that
 * average: aim always weighs the most in osu! pp, so a streamer's aim share is still big,
 * just smaller than usual. The average is measured once on a sample of the catalogue and
 * kept on disk; bump VERSION after a pp rework or a change of measure.
 */
export type SkillValues = Record<ProfileSkill, number>;

/** What one play is measured from. */
export interface PlayRead {
  aim: number;
  speed: number;
  accuracy: number;
  reading: number;
  /** Circle size with the mods. */
  cs: number | null;
  /** Beats per minute with the mods. */
  bpm: number | null;
}

/**
 * The skills of one play; null where it cannot be measured (pattern-based skills need the
 * map's pattern analysis).
 */
export function measurePlay(read: PlayRead, pattern: PatternProfile | null | undefined, rate: number): Partial<SkillValues> {
  const out: Partial<SkillValues> = {};
  const total = read.aim + read.speed + read.accuracy + read.reading;
  if (total > 0) {
    out.aim = read.aim / total;
    out.speed = read.speed / total;
    out.accuracy = read.accuracy / total;
    out.reading = read.reading / total;
  }
  // Precision: small circles, counted from CS 3 (HR included).
  if (read.cs != null) out.precision = Math.max(0.2, read.cs - 3);
  if (pattern) {
    // Tapping: how much of the map is streamed, and how fast (the square of the BPM).
    const bpm = (read.bpm ?? pattern.bpm * rate) / 180;
    out.tapping = (pattern.streamShare + 0.6 * pattern.burstShare + 0.25 * pattern.doubleShare) * bpm * bpm;
    out.fingercontrol = styleScores(pattern, { version: "" }, rate).fingercontrol;
  }
  return out;
}

/** Mean of each skill over many plays, each play weighted; skills missing on a play are skipped. */
export class SkillMean {
  private sum: SkillValues = Object.fromEntries(PROFILE_SKILLS.map((skill) => [skill, 0])) as SkillValues;
  private weight: SkillValues = Object.fromEntries(PROFILE_SKILLS.map((skill) => [skill, 0])) as SkillValues;
  add(values: Partial<SkillValues>, weight = 1): void {
    for (const skill of PROFILE_SKILLS) {
      const value = values[skill];
      if (value == null || !Number.isFinite(value)) continue;
      this.sum[skill] += value * weight;
      this.weight[skill] += weight;
    }
  }
  count(skill: ProfileSkill): number {
    return this.weight[skill];
  }
  value(skill: ProfileSkill): number | null {
    return this.weight[skill] > 0 ? this.sum[skill] / this.weight[skill] : null;
  }
}

const VERSION = 2;
const FILE = join(repoRoot, "cache", `skill-base-v${VERSION}.json`);
/** Used until the sample is measured (rough values from typical farm maps). */
const FALLBACK: SkillValues = { accuracy: 0.14, aim: 0.47, reading: 0.12, precision: 1.2, tapping: 0.12, speed: 0.27, fingercontrol: 0.08 };
const BANDS: [number, number][] = [
  [250, 400],
  [400, 550],
  [550, 750],
  [750, 1200],
];
const PER_BAND = 70;

let measured: SkillValues | null = null;
try {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as { values?: SkillValues };
  if (raw.values && raw.values.aim > 0) measured = raw.values;
} catch {
  // First run.
}

let running: Promise<SkillValues | null> | null = null;

async function measure(): Promise<SkillValues | null> {
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
  const mean = new SkillMean();
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
          mean.add(
            measurePlay(
              { aim: s.aim ?? 0, speed: s.speed ?? 0, accuracy: s.accuracyPp ?? 0, reading: s.reading ?? 0, cs: result.stats.cs ?? null, bpm: result.stats.bpm || null },
              getProfile(hit.beatmapId),
              modRate(hit.mods),
            ),
          );
        } catch {
          // Skip a map that fails.
        }
      }
    }),
  );
  if (mean.count("aim") < 40) return null;
  const values = Object.fromEntries(PROFILE_SKILLS.map((skill) => [skill, mean.count(skill) >= 20 ? mean.value(skill)! : FALLBACK[skill]])) as SkillValues;
  try {
    mkdirSync(join(repoRoot, "cache"), { recursive: true });
    await writeFile(FILE, JSON.stringify({ at: new Date().toISOString(), maps: mean.count("aim"), values }));
  } catch {
    // Measured again after a restart.
  }
  return values;
}

/** The usual values, waiting at most `waitMs` for the first measurement. */
export async function skillBase(waitMs = 8000): Promise<{ values: SkillValues; measured: boolean }> {
  if (measured) return { values: measured, measured: true };
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
  return value ? { values: value, measured: true } : { values: FALLBACK, measured: false };
}
