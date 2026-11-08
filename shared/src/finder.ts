import type { DiscoverSort, MapStyle, NumRange, RangeFilters, SortRule } from "./types";

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

export interface Sortable {
  pp: number;
  stars: number;
  lengthSeconds: number | null;
  bpm?: number | null;
  ar?: number | null;
  farm?: number;
}

function sortValue(item: Sortable, key: SortRule["key"]): number | null {
  switch (key) {
    case "farm":
      return item.farm ?? null;
    case "pp":
      return item.pp;
    case "stars":
      return item.stars;
    case "length":
      return item.lengthSeconds;
    case "bpm":
      return item.bpm ?? null;
    case "ar":
      return item.ar ?? null;
  }
}

/** Sorts by each rule in turn. Missing values go last, whatever the direction. Ties end on PP. */
export function compareDiscover(rules: readonly SortRule[], a: Sortable, b: Sortable): number {
  for (const rule of rules) {
    const left = sortValue(a, rule.key);
    const right = sortValue(b, rule.key);
    if (left == null || right == null) {
      if (left == null && right == null) continue;
      return left == null ? 1 : -1;
    }
    const delta = rule.dir === "asc" ? left - right : right - left;
    // Values within a hair of each other (AR 9.3 vs 9.30001) count as equal.
    if (Math.abs(delta) > 1e-6) return delta;
  }
  return b.pp - a.pp;
}

/** Old single-sort names, kept for saved settings and older clients. */
export function legacySort(sort: DiscoverSort): SortRule[] {
  if (sort === "farm") return [{ key: "farm", dir: "desc" }];
  const [key, dir] = sort.split("-") as [SortRule["key"], SortRule["dir"]];
  return [{ key, dir }];
}

export function emptyRanges(): RangeFilters {
  return { stars: { min: null, max: null }, bpm: { min: null, max: null }, ar: { min: null, max: null }, length: { min: null, max: null } };
}

export function inRange(value: number | null | undefined, range: NumRange): boolean {
  if (range.min == null && range.max == null) return true;
  if (value == null || !Number.isFinite(value)) return false;
  // Small tolerance so "AR 9.3" keeps a map stored as 9.299999.
  if (range.min != null && value < range.min - 1e-6) return false;
  if (range.max != null && value > range.max + 1e-6) return false;
  return true;
}
