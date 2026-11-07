import type { PatternProfile, StyleScores } from "./styles";

export type Mode = "osu" | "taiko" | "catch" | "mania";

export type BeatmapStatus =
  | "ranked"
  | "approved"
  | "qualified"
  | "loved"
  | "pending"
  | "graveyard"
  | "wip"
  | "unknown";

export interface DifficultyChip {
  id: number;
  version: string;
  mode: Mode;
  stars: number | null;
  status: BeatmapStatus;
}

export interface MapMeta {
  beatmapId: number;
  beatmapsetId: number | null;
  title: string;
  artist: string;
  creator: string;
  version: string;
  mode: Mode;
  status: BeatmapStatus;
  cover: string | null;
  difficulties: DifficultyChip[];
}

export interface MapStats {
  stars: number;
  maxCombo: number;
  ar: number | null;
  od: number | null;
  cs: number | null;
  hp: number | null;
  bpm: number;
  lengthSeconds: number;
}

export interface CurvePoint {
  accuracy: number;
  pp: number;
}

export interface ScoreResult {
  accuracy: number;
  combo: number;
  misses: number;
  pp: number;
  aim: number | null;
  speed: number | null;
  accuracyPp: number | null;
  flashlight: number | null;
  difficultyPp: number | null;
}

export interface LookupResponse {
  meta: MapMeta;
  stats: MapStats;
  curve: CurvePoint[];
  score: ScoreResult;
  warnings: string[];
  /** osu! standard only: measured patterns and type scores. */
  pattern: PatternProfile | null;
  styles: StyleScores | null;
  apiKeyConfigured: boolean;
}

export interface CalculateResponse {
  mode: Mode;
  stats: MapStats;
  curve: CurvePoint[];
  score: ScoreResult;
  warnings: string[];
}

export interface SearchHit {
  beatmapsetId: number;
  title: string;
  artist: string;
  creator: string;
  status: BeatmapStatus;
  cover: string | null;
  beatmaps: DifficultyChip[];
}

export interface SearchResponse {
  results: SearchHit[];
  apiKeyConfigured: boolean;
  message: string | null;
}

export const MAP_STYLES = ["any", "jump", "stream", "speed", "tech", "alt", "fingercontrol"] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

export const DISCOVER_SORTS = ["farm", "pp-desc", "pp-asc", "stars-desc", "stars-asc", "length-desc", "length-asc"] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

export interface HealthResponse {
  ok: true;
  apiKeyConfigured: boolean;
}

export type DiscoverNotice = "preview" | "none" | "empty" | "too_many";

export interface DiscoverRequest {
  query: string;
  mode: Mode;
  /** Types to keep (any of them). Empty means every type. */
  styles: Exclude<MapStyle, "any">[];
  mods: Record<"EZ" | "HD" | "HR" | "DT" | "HT" | "FL", "off" | "on" | "any">;
  ppMin: number;
  ppMax: number;
  offset: number;
  sort: DiscoverSort;
}

export interface DiscoverHit {
  beatmapId: number;
  beatmapsetId: number | null;
  title: string;
  artist: string;
  creator: string;
  version: string;
  mode: Mode;
  status: BeatmapStatus;
  cover: string | null;
  stars: number;
  pp: number;
  lengthSeconds: number | null;
  mods: string[];
  style: Exclude<MapStyle, "any"> | null;
  /** 0 to 100. Higher means more pp for the effort. */
  farm: number;
  /** True while the type comes from metadata, before the .osu file is read. */
  estimated: boolean;
}

export interface DiscoverResponse {
  results: DiscoverHit[];
  scanned: number;
  total: number;
  hasMore: boolean;
  nextOffset: number;
  notice: DiscoverNotice;
  styleIgnored: boolean;
  /** Maps near the top still being analysed. Ask again shortly to refine. */
  analyzing: number;
  /** Set when the range was too wide: maps below this PP were not loaded. */
  limitedFrom: number | null;
  /** Set while the PP catalogue for this range is still arriving. Ask again shortly. */
  catalog: { loaded: number; expected: number } | null;
}

export interface CalculateRequest {
  beatmapId: number;
  mode?: Mode;
  mods: string[];
  clockRate: number | null;
  accuracy: number;
  combo: number | null;
  misses: number;
}

export interface LookupRequest {
  beatmapId?: number;
  beatmapsetId?: number;
  mode?: Mode;
  mods: string[];
  clockRate: number | null;
  accuracy: number;
  combo: number | null;
  misses: number;
}

export interface ApiErrorBody {
  error: {
    code:
      | "not_found"
      | "unavailable"
      | "api_key_missing"
      | "suspicious"
      | "invalid"
      | "rate_limited";
    message: string;
  };
}
