import type { MapStyle } from "./types";

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
}

const TAG_RULES: { style: Exclude<MapStyle, "any">; pattern: RegExp }[] = [
  { style: "fingercontrol", pattern: /finger[\s-]*control/i },
  { style: "tech", pattern: /\btech\b/i },
  { style: "alt", pattern: /\balts?\b|\balternate\b/i },
  { style: "speed", pattern: /\bspeed\b/i },
  { style: "stream", pattern: /\bstreams?\b/i },
  { style: "jump", pattern: /\bjumps?\b|\baim(?:[\s-]*slop)?\b/i },
];

export function classifyStyle(input: StyleSignals): Exclude<MapStyle, "any"> | null {
  const text = `${input.tags} ${input.version}`;
  for (const rule of TAG_RULES) {
    if (rule.pattern.test(text)) return rule.style;
  }
  return null;
}

export function textMatches(query: string, fields: readonly string[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function styleMatches(wanted: MapStyle, actual: Exclude<MapStyle, "any">): boolean {
  if (wanted === "any" || wanted === actual) return true;
  if (wanted === "stream") return actual === "speed" || actual === "alt" || actual === "fingercontrol";
  return false;
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
