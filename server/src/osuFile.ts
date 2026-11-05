import type { Mode } from "@osu-pp/shared";

export interface LocalBeatmapInfo {
  beatmapId: number | null;
  beatmapsetId: number | null;
  title: string;
  artist: string;
  creator: string;
  version: string;
  mode: Mode;
  endMs: number;
}

function sections(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current = "";
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const header = trimmed.match(/^\[(.+)\]$/);
    if (header) {
      current = header[1] ?? "";
      if (!map.has(current)) map.set(current, []);
      continue;
    }
    if (!current || !trimmed || trimmed.startsWith("//")) continue;
    map.get(current)?.push(trimmed);
  }
  return map;
}

function field(lines: string[] | undefined, key: string): string | null {
  if (!lines) return null;
  const prefix = `${key}:`;
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return null;
}

function integer(value: string | null): number | null {
  if (!value || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function modeFromNumber(value: string | null): Mode {
  switch (value) {
    case "1":
      return "taiko";
    case "2":
      return "catch";
    case "3":
      return "mania";
    default:
      return "osu";
  }
}

export function parseOsuText(text: string): LocalBeatmapInfo {
  const clean = text.replace(/^\uFEFF/, "");
  const parts = sections(clean);
  const metadata = parts.get("Metadata");
  const general = parts.get("General");
  const hitObjects = parts.get("HitObjects") ?? [];

  let endMs = 0;
  for (const line of hitObjects) {
    const time = Number(line.split(",")[2]);
    if (Number.isFinite(time) && time > endMs) endMs = time;
  }

  const beatmapId = integer(field(metadata, "BeatmapID"));
  const beatmapsetId = integer(field(metadata, "BeatmapSetID"));

  return {
    beatmapId: beatmapId != null && beatmapId > 0 ? beatmapId : null,
    beatmapsetId: beatmapsetId != null && beatmapsetId > 0 ? beatmapsetId : null,
    title: field(metadata, "Title") || "Untitled",
    artist: field(metadata, "Artist") || "Unknown artist",
    creator: field(metadata, "Creator") || "Unknown creator",
    version: field(metadata, "Version") || "Difficulty",
    mode: modeFromNumber(field(general, "Mode")),
    endMs,
  };
}

export function decodeOsu(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}

export function looksLikeOsu(text: string): boolean {
  return text.replace(/^\uFEFF/, "").includes("osu file format");
}
