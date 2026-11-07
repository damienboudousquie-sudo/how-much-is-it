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
