import type { DiscoverSort, MapStyle } from "./types";

export const STYLE_LABELS: Record<MapStyle, string> = {
  any: "Tous types",
  jump: "Jump",
  stream: "Stream",
  speed: "Speed",
  tech: "Tech",
  alt: "Alt",
  fingercontrol: "Finger control",
};

export const STYLE_QUERY: Record<Exclude<MapStyle, "any">, string> = {
  jump: "jump OR aim OR aimslop",
  stream: "stream",
  speed: "speed",
  tech: "tech",
  alt: "alternate",
  fingercontrol: "fingercontrol",
};

export interface StyleSignals {
  tags: string;
  version: string;
  bpm?: number | null;
  /** Notes per second of drain time. */
  density?: number | null;
  /** Share of the objects that are circles. */
  circleRatio?: number | null;
  stars?: number | null;
}

const VERSION_RULES: { style: Exclude<MapStyle, "any">; pattern: RegExp }[] = [
  { style: "fingercontrol", pattern: /finger[\s-]*control/i },
  { style: "tech", pattern: /\btech(?:nical)?\b/i },
  { style: "alt", pattern: /\balternat(?:e|ing)\b|\balts?\b/i },
  { style: "speed", pattern: /\bspeed\b/i },
  { style: "stream", pattern: /\b(?:death\s*)?streams?\b|\bbursts?\b|\bstamina\b/i },
  { style: "jump", pattern: /\bjumps?\b|\baim(?:[\s-]*slop)?\b|\bspaced\b/i },
];

function versionStyle(version: string): Exclude<MapStyle, "any"> | null {
  for (const rule of VERSION_RULES) {
    if (rule.pattern.test(version)) return rule.style;
  }
  return null;
}

/** Whole beatmap tags. Hyphenated words stay intact, so "hi-tech" is not "tech". */
function tagTokens(tags: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of tags.toLowerCase().split(/[\s,;/|]+/)) {
    const token = raw.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (token) tokens.add(token);
  }
  return tokens;
}

function tagStyle(tags: string): Exclude<MapStyle, "any"> | null {
  if (/finger[\s-]*control/i.test(tags)) return "fingercontrol";
  const tokens = tagTokens(tags);
  if (tokens.has("alternate") || tokens.has("alternating") || tokens.has("alternation")) return "alt";
  if (tokens.has("technical") || tokens.has("tech")) return "tech";
  if (tokens.has("speed")) return "speed";
  return null;
}

/**
 * A type is kept only when that pattern can be most of the map.
 * Notes per beat near 1 is a 1/4 stream, not a jump, even if a few notes are spaced.
 */
function structuralStyle(input: StyleSignals): Exclude<MapStyle, "any"> | null {
  const bpm = input.bpm;
  const density = input.density;
  const circles = input.circleRatio;
  if (bpm == null || density == null || circles == null || bpm < 80) return null;
  const perBeat = density / (bpm / 60);
  const spacing = input.stars != null && density > 0 ? input.stars / density : null;
  const finger =
    bpm <= 175 && perBeat >= 2.35 && circles >= 0.8 && density >= 6.2 && (spacing == null || spacing < 1.2);
  if (finger) return "fingercontrol";
  const speed = bpm >= 248 && density >= 5.5 && perBeat >= 1.2 && circles >= 0.6 && (spacing == null || spacing < 1.55);
  if (speed) return "speed";
  const filledStream = perBeat >= 1.75 && density >= 5.6 && circles >= 0.7;
  if (filledStream) return "stream";
  const slowJumps = perBeat <= 0.8 && density >= 2.2 && density <= 5.2 && circles <= 0.8;
  const spacedJumps =
    spacing != null && spacing >= 1.7 && perBeat <= 1.2 && perBeat >= 0.45 && density <= 5.3 && circles <= 0.78;
  if (slowJumps || spacedJumps) return "jump";
  const tech =
    spacing != null &&
    circles <= 0.55 &&
    perBeat >= 1.3 &&
    perBeat <= 1.95 &&
    spacing >= 1.32 &&
    spacing <= 1.68 &&
    density >= 4.3 &&
    density <= 6.4 &&
    bpm >= 145 &&
    bpm <= 220;
  if (tech) return "tech";
  const alt =
    spacing != null &&
    circles >= 0.72 &&
    perBeat >= 1.32 &&
    perBeat <= 1.58 &&
    spacing >= 1.34 &&
    spacing <= 1.56 &&
    density >= 4.5 &&
    density <= 5.8 &&
    bpm >= 185 &&
    bpm <= 235;
  if (alt) return "alt";
  return null;
}

export function classifyStyle(input: StyleSignals): Exclude<MapStyle, "any"> | null {
  const shape = structuralStyle(input);
  let named = versionStyle(input.version);
  const tagged = tagStyle(input.tags);
  const perBeat = input.bpm && input.density ? input.density / (input.bpm / 60) : null;
  if (shape === "stream" || shape === "speed" || shape === "jump") return shape;
  if (shape === "fingercontrol" && named !== "stream" && named !== "speed" && named !== "jump") return "fingercontrol";
  if (named === "jump" && perBeat != null && perBeat >= 1.15 && (input.density ?? 0) >= 4.8) named = null;
  if (named === "stream" && perBeat != null && perBeat <= 0.85) named = null;
  if (named) return named;
  if (tagged === "speed" && input.bpm != null && input.bpm < 200) return shape === "fingercontrol" ? "fingercontrol" : shape;
  if (tagged) return tagged;
  return shape;
}

export function textMatches(query: string, fields: readonly string[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function styleMatches(wanted: MapStyle, actual: Exclude<MapStyle, "any">): boolean {
  return wanted === "any" || wanted === actual;
}

export function compareDiscover(
  sort: DiscoverSort,
  a: { pp: number; stars: number; lengthSeconds: number | null },
  b: { pp: number; stars: number; lengthSeconds: number | null },
): number {
  const desc = sort.endsWith("desc");
  let delta = 0;
  if (sort.startsWith("stars")) delta = a.stars - b.stars;
  else if (sort.startsWith("length")) {
    if (a.lengthSeconds == null || b.lengthSeconds == null) {
      if (a.lengthSeconds == null && b.lengthSeconds == null) delta = 0;
      else return a.lengthSeconds == null ? 1 : -1;
    } else delta = a.lengthSeconds - b.lengthSeconds;
  } else delta = a.pp - b.pp;
  const directed = desc ? -delta : delta;
  if (directed !== 0) return directed;
  return sort.startsWith("pp") ? b.stars - a.stars : b.pp - a.pp;
}

export function modPpFactor(mods: readonly string[], clockRate: number | null): number {
  let factor = 1;
  if (mods.includes("DT") || mods.includes("NC")) factor *= 1.85;
  if (mods.includes("HT")) factor *= 0.4;
  if (mods.includes("HR")) factor *= 1.12;
  if (mods.includes("EZ")) factor *= 0.55;
  if (mods.includes("HD")) factor *= 1.06;
  if (mods.includes("FL")) factor *= 1.25;
  if (clockRate != null) {
    const base = mods.includes("HT") ? 0.75 : mods.includes("DT") || mods.includes("NC") ? 1.5 : 1;
    if (Math.abs(clockRate - base) > 0.02) factor *= (clockRate / base) ** 2.2;
  }
  return factor;
}

/** Nomod star band likely to land in the requested modded PP range. Wide on purpose. */
export function starWindow(ppMin: number, ppMax: number, mods: readonly string[], clockRate: number | null): [number, number] {
  const factor = modPpFactor(mods, clockRate);
  const starsFor = (pp: number) => (Math.max(pp, 1) / factor / 0.24) ** 0.25;
  return [Math.max(0.4, starsFor(ppMin) - 1.5), Math.min(13, starsFor(ppMax) + 1.5)];
}

export function targetStars(ppMin: number, ppMax: number, mods: readonly string[], clockRate: number | null): number {
  const factor = modPpFactor(mods, clockRate);
  return (Math.max((ppMin + ppMax) / 2, 1) / factor / 0.24) ** 0.25;
}
