import type { ConcreteStyle, StyleScores } from "./styles";

/**
 * Farm maps give more pp than they cost. In practice:
 * - aim-heavy jump maps, because star rating and pp reward spaced movement more than it feels,
 * - a drain cheap to retry: under about 2 min 40 for jump maps, up to 5 min for stream maps,
 * - a lower star rating than other maps worth the same pp,
 * - often anime TV sizes and cuts, and mappers known for farm sets.
 */

const FARM_MAPPERS = new Set([
  "sotarks", "fieryrage", "log off now", "taeyang", "akitoshi", "kroytz",
  "reform", "kuki", "nevo", "kumocha", "parad0xa", "my angel ram", "ajt",
]);
const SHORT_CUT = /\b(?:tv[\s.-]*(?:size|ver(?:sion)?)|cut[\s.-]*ver(?:sion)?|short[\s.-]*ver(?:sion)?|game[\s.-]*ver(?:sion)?|sped[\s-]*up|nightcore)\b/i;

/** 0 to 1, from title, mapper and tags. Computed once when a map enters the index. */
export function farmHint(input: { title: string; creator: string; tags: string }): number {
  let hint = 0;
  if (SHORT_CUT.test(input.title)) hint += 0.5;
  if (FARM_MAPPERS.has(input.creator.trim().toLowerCase())) hint += 0.5;
  if (/(?:^|\s)(?:farm|pp[\s-]*farm)(?:\s|$)/i.test(input.tags)) hint += 0.4;
  return Math.min(1, hint);
}

/** Points (seconds, score) joined by straight lines; flat before the first and after the last. */
type Curve = readonly (readonly [number, number])[];

/**
 * How cheap a map is to retry, by drain time, for each type. Stream and stamina maps are
 * long by nature, so their sweet spot reaches much further than for jump maps.
 */
const LENGTH_CURVES: Record<ConcreteStyle, Curve> = {
  jump: [[10, 0.4], [22, 1], [160, 1], [260, 0.6], [400, 0.3], [600, 0.2]],
  stream: [[15, 0.4], [35, 1], [300, 1], [480, 0.7], [720, 0.4], [900, 0.3]],
  speed: [[15, 0.4], [30, 1], [210, 1], [360, 0.6], [540, 0.3]],
  tech: [[10, 0.4], [22, 1], [200, 1], [320, 0.6], [480, 0.3]],
  alt: [[15, 0.4], [30, 1], [240, 1], [400, 0.6], [600, 0.3]],
  fingercontrol: [[10, 0.4], [22, 1], [200, 1], [320, 0.6], [480, 0.3]],
};

function onCurve(curve: Curve, x: number): number {
  if (x <= curve[0]![0]) return curve[0]![1];
  for (let index = 1; index < curve.length; index += 1) {
    const [x1, y1] = curve[index]!;
    const [x0, y0] = curve[index - 1]!;
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return curve[curve.length - 1]![1];
}

/** 0 to 1. With several types, the most lenient one counts; with none, jump maps set the pace. */
export function lengthScore(seconds: number | null, wanted: readonly ConcreteStyle[] = []): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 0.5;
  const styles = wanted.length > 0 ? wanted : (["jump"] as const);
  return Math.max(...styles.map((style) => onCurve(LENGTH_CURVES[style], seconds)));
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
  /** 0 to 1 from play counts, or null when unknown. A hidden nudge, never the main reason. */
  popularity?: number | null;
}

/** Share of the farm score given to popularity. Small, so farm qualities always lead. */
export const POPULARITY_WEIGHT = 0.1;

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
    // Type first, then cheap pp, then how cheap a retry is, then the hints.
    const farm =
      0.35 * typeFit(map.scores, wanted) +
      0.3 * efficiency +
      0.2 * lengthScore(map.lengthSeconds, wanted) +
      0.15 * map.hint;
    // Unknown popularity counts as average, so a map is not held back before its plays are read.
    const popularity = map.popularity ?? 0.5;
    const score = (1 - POPULARITY_WEIGHT) * farm + POPULARITY_WEIGHT * popularity;
    return Math.round(score * 100);
  });
}
