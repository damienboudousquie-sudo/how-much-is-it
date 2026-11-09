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

/** Main types first (jump, stream, hybrid), then the secondary tags that narrow them. */
export const MAP_STYLES = ["any", "jump", "stream", "hybrid", "speed", "hjump", "hstream", "tech", "alt", "fingercontrol"] as const;
export type MapStyle = (typeof MAP_STYLES)[number];

/** Single sorts from before sorts could be combined. Still accepted by the API. */
export const DISCOVER_SORTS = ["farm", "pp-desc", "pp-asc", "stars-desc", "stars-asc", "length-desc", "length-asc"] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];

export const SORT_KEYS = ["farm", "pp", "stars", "length", "bpm", "ar"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
/** One sort criterion. A list of them sorts by the first, then breaks ties with the next. */
export interface SortRule {
  key: SortKey;
  dir: SortDir;
}
export const MAX_SORT_RULES = 4;

/** Inclusive bounds; null means open on that side. */
export interface NumRange {
  min: number | null;
  max: number | null;
}
export const RANGE_KEYS = ["stars", "bpm", "ar", "length"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];
export type RangeFilters = Record<RangeKey, NumRange>;

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
  /** Sort criteria, most important first. */
  sort: SortRule[];
  /** Stars, BPM and AR as played with the mods; length in seconds, with DT/HT applied. */
  ranges: RangeFilters;
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
  /** BPM and AR with the mods applied. */
  bpm: number | null;
  ar: number | null;
  mods: string[];
  /** Main type: jump, stream or hybrid. */
  style: Exclude<MapStyle, "any"> | null;
  /** Secondary tags: speed for streams; jump, stream, tech, alt, fingercontrol for hybrids (several). */
  tags: Exclude<MapStyle, "any">[];
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
      | "rate_limited"
      | "login_off"
      | "login_failed"
      | "signed_out";
    message: string;
  };
}

/* ---------- signed-in player ---------- */

/** How a player marked a map: to farm later, or already done. */
export type MapMark = "farm" | "done";

export interface UserProfile {
  id: number;
  username: string;
  avatarUrl: string | null;
  country: string | null;
  pp: number | null;
  rank: number | null;
}

/** One of the player's top 100 plays. */
export interface TopPlay {
  beatmapId: number;
  pp: number;
  accuracy: number | null;
  mods: string[];
}

/** What a pinned map looked like when it was pinned, to list it without a lookup. */
export interface PinInfo {
  beatmapId: number;
  beatmapsetId: number | null;
  mode: Mode;
  title: string;
  artist: string;
  version: string;
  creator: string;
  cover: string | null;
  stars: number;
  pp: number;
  mods: string[];
  lengthSeconds: number | null;
  bpm: number | null;
  ar: number | null;
  style: Exclude<MapStyle, "any"> | null;
  tags: Exclude<MapStyle, "any">[];
  /** When it was pinned (ms). */
  at: number;
}

export interface MeResponse {
  signedIn: boolean;
  /** False when the server has no osu! OAuth application set up. */
  loginAvailable: boolean;
  profile: UserProfile | null;
  marks: Record<string, MapMark>;
  pins: Record<string, PinInfo>;
  top: TopPlay[];
  /** True for the site owner: can read the feedback. */
  admin?: boolean;
}

export type FeedbackKind = "bug" | "idea" | "other";

export interface FeedbackItem {
  id: string;
  at: string;
  kind: FeedbackKind;
  message: string;
  contact: string | null;
  page: string | null;
  lang: string | null;
  user: { id: number; username: string } | null;
  done: boolean;
}

/** A map suggested from the player's top plays, with the pp it would add to their profile. */
export interface RecommendHit extends DiscoverHit {
  gain: number;
}

export interface RecommendResponse {
  /** FC (SS) pp range the suggestions come from: that of the maps in the top plays. */
  ppMin: number;
  ppMax: number;
  /** Share of a map's SS pp the player usually gets (their top plays are not all SS). */
  ratio: number;
  /** Mod combos of the top plays, most played first (share 0–1). */
  mods: { mods: string[]; share: number }[];
  /** Map types of the top plays (share 0–1). */
  styles: { style: string; share: number }[];
  /** Map types the suggestions are taken from, read from the top like a map's type. */
  wanted: string[];
  results: RecommendHit[];
}
