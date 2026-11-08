import type { Lang, Mode } from "@osu-pp/shared";

let locale = "en-US";

export function setNumberLocale(lang: Lang): void {
  locale = lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US";
}

export function formatPp(value: number, digits = 0): string {
  return value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatStars(value: number): string {
  return value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCount(value: number): string {
  return value.toLocaleString(locale);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function formatBpm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toLocaleString(locale, { maximumFractionDigits: 1 });
}

export function formatLength(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatRate(value: number): string {
  return `${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

export function osuMapUrl(beatmapsetId: number | null, beatmapId: number, mode: Mode): string {
  const ruleset = mode === "catch" ? "fruits" : mode;
  if (beatmapsetId != null && beatmapsetId > 0) return `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#${ruleset}/${beatmapId}`;
  return `https://osu.ppy.sh/beatmaps/${beatmapId}`;
}

export function osuDirectUrl(beatmapsetId: number | null, beatmapId: number): string {
  if (beatmapsetId != null && beatmapsetId > 0) return `osu://dl/${beatmapsetId}`;
  return `osu://b/${beatmapId}`;
}

/** Plain left click: let the app route instead of the browser. */
export function plainClick(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/* Star rating colours: the difficulty spectrum used by osu! (blue → green → yellow → red → purple → black). */
const STAR_STOPS: [number, [number, number, number]][] = [
  [0.1, [66, 144, 251]],
  [1.25, [79, 192, 255]],
  [2, [79, 255, 213]],
  [2.5, [124, 255, 79]],
  [3.3, [246, 240, 92]],
  [4.2, [255, 128, 104]],
  [4.9, [255, 78, 111]],
  [5.8, [198, 69, 184]],
  [6.7, [101, 99, 222]],
  [7.7, [24, 21, 142]],
  [9, [0, 0, 0]],
];

export function starColors(stars: number): { background: string; text: string } {
  const value = Math.max(0.1, Math.min(9, stars));
  let rgb = STAR_STOPS[STAR_STOPS.length - 1]![1];
  for (let index = 1; index < STAR_STOPS.length; index += 1) {
    const [high, to] = STAR_STOPS[index]!;
    if (value <= high) {
      const [low, from] = STAR_STOPS[index - 1]!;
      // osu! blends in gamma space; a plain blend is close enough at this size.
      const ratio = (value - low) / (high - low);
      rgb = [0, 1, 2].map((channel) => Math.round(from[channel]! + (to[channel]! - from[channel]!) * ratio)) as [number, number, number];
      break;
    }
  }
  return {
    background: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    // Dark text on light colours; osu!'s pale gold on the dark end of the scale.
    text: stars >= 6.5 ? "#ffd966" : "rgba(0, 0, 0, 0.78)",
  };
}
