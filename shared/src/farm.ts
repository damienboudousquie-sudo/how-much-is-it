import type { ConcreteStyle, StyleScores } from "./styles";

/**
 * Farm maps give more pp than they cost. In practice:
 * - aim-heavy jump maps, because star rating and pp reward spaced movement more than it feels,
 * - short drain (about 45 s to 2 min 10), so a run is cheap to retry,
 * - a lower star rating than other maps worth the same pp,
 * - often anime TV sizes and cuts, and mappers known for farm sets.
 */

const FARM_MAPPERS = new Set(["sotarks", "fieryrage", "log off now", "taeyang", "akitoshi", "kroytz"]);
const SHORT_CUT = /\b(?:tv[\s.-]*(?:size|ver(?:sion)?)|cut[\s.-]*ver(?:sion)?|short[\s.-]*ver(?:sion)?|game[\s.-]*ver(?:sion)?|sped[\s-]*up)\b/i;

/** 0 to 1, from title, mapper and tags. Computed once when a map enters the index. */
export function farmHint(input: { title: string; creator: string; tags: string }): number {
  let hint = 0;
  if (SHORT_CUT.test(input.title)) hint += 0.5;
  if (FARM_MAPPERS.has(input.creator.trim().toLowerCase())) hint += 0.5;
  if (/(?:^|\s)(?:farm|pp[\s-]*farm)(?:\s|$)/i.test(input.tags)) hint += 0.4;
  return Math.min(1, hint);
}

export function lengthScore(seconds: number | null): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 0.5;
  if (seconds < 20) return 0.3;
  if (seconds < 45) return 0.3 + (0.7 * (seconds - 20)) / 25;
  if (seconds <= 130) return 1;
  if (seconds <= 200) return 1 - (0.45 * (seconds - 130)) / 70;
  if (seconds <= 300) return 0.55 - (0.35 * (seconds - 200)) / 100;
  return 0.1;
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** How well the map fits what the player wants to farm: the chosen types, or jump maps by default. */
export function typeFit(scores: StyleScores, wanted: readonly ConcreteStyle[]): number {
  if (wanted.length > 0) return Math.max(...wanted.map((style) => scores[style]));
  const against = Math.max(scores.stream, scores.speed, scores.tech, scores.fingercontrol);
  return 0.15 + 0.85 * clamp(scores.jump - 0.4 * against);
}

export interface FarmCandidate {
  pp: number;
  stars: number;
  lengthSeconds: number | null;
  hint: number;
  scores: StyleScores;
}

/** log(pp) minus what stars and length usually give. Positive means cheap pp. */
function residual(map: FarmCandidate): number {
  const length = Math.max(30, map.lengthSeconds ?? 120);
  return Math.log(Math.max(1, map.pp)) - (2.6 * Math.log(Math.max(0.5, map.stars)) + 0.15 * Math.log(length));
}

/** Farm score, 0 to 100, for every candidate. Efficiency is relative to the other candidates. */
export function farmScores(maps: readonly FarmCandidate[], wanted: readonly ConcreteStyle[]): number[] {
  if (maps.length === 0) return [];
  const values = maps.map(residual);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
  const spread = Math.max(0.02, 1.4826 * deviations[Math.floor(deviations.length / 2)]!);
  return maps.map((map, index) => {
    const efficiency = 1 / (1 + Math.exp(-(values[index]! - median) / spread));
    const score =
      0.35 * typeFit(map.scores, wanted) + 0.25 * lengthScore(map.lengthSeconds) + 0.25 * efficiency + 0.15 * map.hint;
    return Math.round(score * 100);
  });
}
