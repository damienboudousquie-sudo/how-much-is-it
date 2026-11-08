import type { MapStyle } from "./types";

export type ConcreteStyle = Exclude<MapStyle, "any">;
export const CONCRETE_STYLES: readonly ConcreteStyle[] = ["jump", "stream", "hybrid", "speed", "hjump", "hstream", "tech", "alt", "fingercontrol"];

/** Every map is one of these, or none when it has too little of anything (easy maps). */
export const MAIN_STYLES = ["jump", "stream", "hybrid"] as const;
export type MainStyle = (typeof MAIN_STYLES)[number];

/** Secondary tags, each narrowing one main type. */
export const SECONDARY_STYLES = ["speed", "hjump", "hstream", "tech", "alt", "fingercontrol"] as const;
export type SecondaryStyle = (typeof SECONDARY_STYLES)[number];
export const PARENT_STYLE: Record<SecondaryStyle, MainStyle> = {
  speed: "stream",
  hjump: "hybrid",
  hstream: "hybrid",
  tech: "hybrid",
  alt: "hybrid",
  fingercontrol: "hybrid",
};

export function isMainStyle(style: ConcreteStyle): style is MainStyle {
  return style === "jump" || style === "stream" || style === "hybrid";
}

export function parentOf(style: ConcreteStyle): MainStyle {
  return isMainStyle(style) ? style : PARENT_STYLE[style];
}

/** Measured from the hit objects of an osu! standard map (see server/src/patterns.ts). */
export interface PatternProfile {
  v: number;
  objects: number;
  bpm: number;
  streamShare: number;
  burstShare: number;
  doubleShare: number;
  longestStream: number;
  streamSpacing: number;
  jumpShare: number;
  jumpSpacing: number;
  speedShare: number;
  sliderShare: number;
  irregularShare: number;
  rhythmEntropy: number;
  svChanges: number;
  drain: number;
}

export type StyleScores = Record<ConcreteStyle, number>;

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 0 at `from`, 1 at `to`, linear between. Works in both directions. */
function ramp(value: number, from: number, to: number): number {
  return clamp((value - from) / (to - from));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const NAME_HINTS: { style: ConcreteStyle; pattern: RegExp }[] = [
  { style: "fingercontrol", pattern: /finger[\s-]*control/i },
  { style: "tech", pattern: /\btech(?:nical)?\b/i },
  { style: "alt", pattern: /\balternat(?:e|ing|ion)\b/i },
  { style: "speed", pattern: /\bspeed\b/i },
  { style: "stream", pattern: /\b(?:death\s*)?streams?\b|\bstamina\b/i },
  { style: "jump", pattern: /\bjumps?\b|\baim(?:[\s-]*slop)?\b/i },
];

/**
 * How strongly each type describes the map, from 0 to 1.
 *
 * `rate` is the clock rate of the mods (DT 1.5, HT 0.75): a 180 BPM stream map
 * played with DT is a 270 BPM speed map.
 *
 * - stream: long 1/4 chains and bursts carry the map, jumps allowed in between.
 * - speed (tag of stream): those streams, fast: about 240 BPM and up, mods counted.
 *   Fast 1/2 jumps are not speed: DT aim maps stay jump maps.
 * - jump: at least 60 % spaced 1/2 and 1/1 movement (50 to 60 % ranks lower, by ratio),
 *   few streams, at any speed; with DT this is
 *   "speed aim". Fast maps mixing jumps with complex rhythm and sliders are tech.
 * - alt: short 1/4 bursts and doubles mixed into patterns, too fast to single-tap.
 * - fingercontrol: uneven rhythm (1/3, 1/6, 3/4 gaps) and short chains at moderate BPM.
 * - tech: slider-heavy, frequent SV changes, varied rhythm.
 * - hybrid: jumps mixed with streams, bursts or sliders, neither clearly jump nor stream.
 *
 * jump, stream and hybrid are the main types; speed narrows stream, and tech, alt and
 * fingercontrol narrow hybrid.
 */
export function styleScores(profile: PatternProfile, names?: { version?: string; tags?: string }, rate = 1): StyleScores {
  const p = profile;
  const bpm = p.bpm * (rate > 0 ? rate : 1);
  const streamMass = p.streamShare + 0.6 * p.burstShare;
  // A map carried by streams and bursts is a stream map even with jumps in between
  // (FREEDOM DiVE). How pure it is decides its rank, see streamPurity.
  const streamCore = ramp(streamMass, 0.25, 0.55) * (1 - 0.6 * ramp(p.jumpShare, 0.35, 0.7));
  // Speed starts around 240 BPM: 200 BPM streams are plain streams.
  const fast = ramp(bpm, 228, 248);

  const speed = streamCore * fast;
  // Fast streams are still streams; speed is their secondary tag.
  const stream = streamCore;

  // Fast maps (nomod BPM, so DT aim maps are not affected) whose jumps come with complex
  // rhythm, slider-heavy sections and streams are tech / mixed maps, not jump maps
  // (IMAGE -MATERIAL- for instance).
  const mixed =
    ramp(p.bpm, 210, 245) *
    (0.45 * ramp(p.rhythmEntropy, 1.9, 2.15) +
      0.35 * ramp(p.sliderShare, 0.45, 0.62) +
      0.3 * ramp(p.streamShare + 0.4 * p.burstShare, 0.1, 0.25));
  // 60 % of jumps or more: a jump map. From 60 % down to 50 % it still is one, ranked by
  // its jump ratio (0.55 at 50 %, the lowest score that still matches). Under 50 %, no.
  const jumpRatio =
    p.jumpShare >= 0.5 ? 0.55 + 0.45 * ramp(p.jumpShare, 0.5, 0.6) : 0.55 * ramp(p.jumpShare, 0.4, 0.5);
  // Between 50 and 60 % of jumps, a fair share of streams or sliders makes it a hybrid map.
  const blend =
    (1 - ramp(p.jumpShare, 0.5, 0.6)) *
    (0.5 * ramp(p.streamShare + 0.6 * p.burstShare, 0.06, 0.15) + 0.5 * ramp(p.sliderShare, 0.35, 0.5));
  const jump =
    jumpRatio *
    (1 - 0.45 * blend) *
    (1 - ramp(p.streamShare, 0.22, 0.5)) *
    (0.85 + 0.15 * ramp(p.jumpSpacing, 4.5, 6.5)) *
    clamp(1 - mixed);

  const shortChains = p.burstShare + 0.5 * p.doubleShare;
  const alt = ramp(shortChains, 0.2, 0.4) * ramp(bpm, 160, 190) * (1 - ramp(p.streamShare, 0.35, 0.6));

  const unevenRhythm = 0.5 * ramp(p.irregularShare, 0.06, 0.2) + 0.5 * ramp(p.rhythmEntropy, 1.9, 2.3);
  const fingercontrol =
    unevenRhythm * ramp(p.burstShare + p.doubleShare, 0.15, 0.35) * (1 - ramp(bpm, 200, 230)) * (1 - 0.5 * ramp(p.streamShare, 0.4, 0.7));

  const tech = clamp(
    (0.4 * ramp(p.sliderShare, 0.3, 0.5) + 0.3 * ramp(p.svChanges, 15, 60) + 0.3 * ramp(p.rhythmEntropy, 1.8, 2.2)) *
      (1 - 0.7 * ramp(p.streamShare, 0.3, 0.6)) +
      0.3 * mixed * ramp(p.jumpShare, 0.3, 0.5),
  );

  // Hybrid: real jumps mixed with streams, bursts or sliders, without being clearly
  // a jump map or a stream map. Easy maps with little of either stay without a type.
  const hybrid =
    (1 - Math.max(jump, streamCore)) *
    ramp(p.jumpShare + streamMass, 0.3, 0.5) *
    ramp(p.jumpShare, 0.12, 0.25);

  // Hybrid leanings, shown as the Jump and Stream tags of a hybrid map (both can apply).
  const hjump = ramp(p.jumpShare, 0.25, 0.45);
  const hstream = ramp(streamMass, 0.12, 0.3);

  const scores: StyleScores = { jump, stream, hybrid, speed, hjump, hstream, tech, alt, fingercontrol };
  const text = `${names?.version ?? ""} ${names?.tags ?? ""}`;
  for (const hint of NAME_HINTS) {
    if (hint.pattern.test(text)) scores[hint.style] = clamp(scores[hint.style] + 0.2);
  }
  for (const style of CONCRETE_STYLES) scores[style] = round2(scores[style]);
  return scores;
}

/**
 * 0 to 1: how much a stream map is only streams and bursts. Jumps between the streams
 * and widely spaced streams lower it. Tower of Heaven is near 1, FREEDOM DiVE lower.
 * Used to rank stream and speed maps, not to decide their type.
 */
export function streamPurity(profile: PatternProfile): number {
  return clamp(1 - 0.6 * ramp(profile.jumpShare, 0.1, 0.35) - 0.3 * ramp(profile.streamSpacing, 2.2, 3.5));
}

/** Main type: jump, stream or hybrid, or null when none reaches 0.5. */
export function primaryStyle(scores: StyleScores): MainStyle | null {
  let best: MainStyle | null = null;
  let value = 0;
  for (const style of MAIN_STYLES) {
    if (scores[style] > value) {
      value = scores[style];
      best = style;
    }
  }
  return value >= 0.5 ? best : null;
}

/**
 * Secondary tags of the main type: speed for streams; for hybrids, every tag that fits
 * (jump, stream, tech, alt, fingercontrol), strongest first.
 */
export function secondaryStyles(scores: StyleScores, main: MainStyle | null = primaryStyle(scores)): SecondaryStyle[] {
  if (main == null || main === "jump") return [];
  return SECONDARY_STYLES.filter((style) => PARENT_STYLE[style] === main && scores[style] >= 0.55).sort((x, y) => scores[y] - scores[x]);
}

/** Clock rate of a mod list: DT and NC 1.5, HT 0.75. */
export function modRate(mods: readonly string[]): number {
  if (mods.includes("DT") || mods.includes("NC")) return 1.5;
  if (mods.includes("HT")) return 0.75;
  return 1;
}

/**
 * The types that really filter: a secondary tag replaces its main type when both are
 * picked (stream + speed means fast streams only), and implies it when picked alone.
 */
export function effectiveStyles(wanted: readonly ConcreteStyle[]): ConcreteStyle[] {
  const narrowed = new Set(wanted.filter((style) => !isMainStyle(style)).map(parentOf));
  return wanted.filter((style) => !(isMainStyle(style) && narrowed.has(style)));
}

/** A map matches when one of the wanted types fits it. No type wanted means every map. */
export function matchesAnyStyle(scores: StyleScores, wanted: readonly ConcreteStyle[]): boolean {
  return wanted.length === 0 || effectiveStyles(wanted).some((style) => matchesStyleScores(scores, style));
}

/**
 * Main type: strong (0.55) and close to the best main type (75 %).
 * Secondary tag: its main type matches and the tag is strong; several tags can match.
 */
export function matchesStyleScores(scores: StyleScores, wanted: MapStyle): boolean {
  if (wanted === "any") return true;
  const value = scores[wanted];
  if (isMainStyle(wanted)) {
    let max = 0;
    for (const style of MAIN_STYLES) max = Math.max(max, scores[style]);
    return value >= 0.55 && value >= 0.75 * max;
  }
  // A tag needs its main type; a map can carry several tags.
  return matchesStyleScores(scores, PARENT_STYLE[wanted]) && value >= 0.55;
}

/** Scores guessed from metadata only, before the .osu file is read. */
export function guessedScores(guess: ConcreteStyle | null): StyleScores {
  const scores: StyleScores = { jump: 0.3, stream: 0.3, hybrid: 0.3, speed: 0.15, hjump: 0.15, hstream: 0.15, tech: 0.15, alt: 0.15, fingercontrol: 0.1 };
  if (guess) {
    scores[guess] = 0.6;
    scores[parentOf(guess)] = 0.6;
  }
  return scores;
}
