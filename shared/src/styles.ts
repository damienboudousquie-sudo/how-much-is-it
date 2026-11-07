import type { MapStyle } from "./types";

export type ConcreteStyle = Exclude<MapStyle, "any">;
export const CONCRETE_STYLES: readonly ConcreteStyle[] = ["jump", "stream", "speed", "tech", "alt", "fingercontrol"];

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
 * - stream: long 1/4 chains carry the map (bursts count a little).
 * - speed: those streams, fast. Around 200 BPM and up (sytho-style speed streams).
 *   Fast 1/2 jumps are not speed: DT aim maps stay jump maps.
 * - jump: spaced 1/2 and 1/1 movement, few streams, at any speed.
 * - alt: short 1/4 bursts and doubles mixed into patterns, too fast to single-tap.
 * - fingercontrol: uneven rhythm (1/3, 1/6, 3/4 gaps) and short chains at moderate BPM.
 * - tech: slider-heavy, frequent SV changes, varied rhythm.
 */
export function styleScores(profile: PatternProfile, names?: { version?: string; tags?: string }, rate = 1): StyleScores {
  const p = profile;
  const bpm = p.bpm * (rate > 0 ? rate : 1);
  const streamMass = p.streamShare + 0.4 * p.burstShare;
  const streamCore = ramp(streamMass, 0.25, 0.55) * (1 - 0.6 * ramp(p.jumpShare, 0.35, 0.7));
  const fast = ramp(bpm, 185, 205);

  const speed = streamCore * fast;
  const stream = streamCore * (1 - 0.25 * fast);

  const jump =
    ramp(p.jumpShare, 0.22, 0.5) * (1 - ramp(p.streamShare, 0.22, 0.5)) * (0.85 + 0.15 * ramp(p.jumpSpacing, 4.5, 6.5));

  const shortChains = p.burstShare + 0.5 * p.doubleShare;
  const alt = ramp(shortChains, 0.2, 0.4) * ramp(bpm, 160, 190) * (1 - ramp(p.streamShare, 0.35, 0.6));

  const unevenRhythm = 0.5 * ramp(p.irregularShare, 0.06, 0.2) + 0.5 * ramp(p.rhythmEntropy, 1.9, 2.3);
  const fingercontrol =
    unevenRhythm * ramp(p.burstShare + p.doubleShare, 0.15, 0.35) * (1 - ramp(bpm, 200, 230)) * (1 - 0.5 * ramp(p.streamShare, 0.4, 0.7));

  const tech =
    (0.4 * ramp(p.sliderShare, 0.3, 0.5) + 0.3 * ramp(p.svChanges, 15, 60) + 0.3 * ramp(p.rhythmEntropy, 1.8, 2.2)) *
    (1 - 0.7 * ramp(p.streamShare, 0.3, 0.6));

  const scores: StyleScores = { jump, stream, speed, tech, alt, fingercontrol };
  const text = `${names?.version ?? ""} ${names?.tags ?? ""}`;
  for (const hint of NAME_HINTS) {
    if (hint.pattern.test(text)) scores[hint.style] = clamp(scores[hint.style] + 0.2);
  }
  for (const style of CONCRETE_STYLES) scores[style] = round2(scores[style]);
  return scores;
}

export function primaryStyle(scores: StyleScores): ConcreteStyle | null {
  let best: ConcreteStyle | null = null;
  let value = 0;
  for (const style of CONCRETE_STYLES) {
    if (scores[style] > value) {
      value = scores[style];
      best = style;
    }
  }
  // A fast stream map is labelled speed even though it is a stream map too.
  if (best === "stream" && scores.speed >= 0.55 && scores.speed >= 0.75 * scores.stream) best = "speed";
  return value >= 0.5 ? best : null;
}

/** Clock rate of a mod list: DT and NC 1.5, HT 0.75. */
export function modRate(mods: readonly string[]): number {
  if (mods.includes("DT") || mods.includes("NC")) return 1.5;
  if (mods.includes("HT")) return 0.75;
  return 1;
}

/** A map matches when one of the wanted types fits it. No type wanted means every map. */
export function matchesAnyStyle(scores: StyleScores, wanted: readonly ConcreteStyle[]): boolean {
  return wanted.length === 0 || wanted.some((style) => matchesStyleScores(scores, style));
}

/** A map matches a type when the type is strong and close to its main type. */
export function matchesStyleScores(scores: StyleScores, wanted: MapStyle): boolean {
  if (wanted === "any") return true;
  const value = scores[wanted];
  let max = 0;
  for (const style of CONCRETE_STYLES) max = Math.max(max, scores[style]);
  return value >= 0.55 && value >= 0.75 * max;
}

/** Scores guessed from metadata only, before the .osu file is read. */
export function guessedScores(guess: ConcreteStyle | null): StyleScores {
  const scores: StyleScores = { jump: 0.3, stream: 0.3, speed: 0.15, tech: 0.15, alt: 0.15, fingercontrol: 0.1 };
  if (guess) scores[guess] = 0.6;
  return scores;
}
