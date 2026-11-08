import {
  FINDER_MODS,
  DISCOVER_SORTS,
  MAP_STYLES,
  MAX_SORT_RULES,
  RANGE_KEYS,
  SORT_KEYS,
  emptyFilters,
  emptyRanges,
  legacySort,
  validId,
  type CalculateRequest,
  type DiscoverRequest,
  type DiscoverSort,
  type FinderMod,
  type LookupRequest,
  type MapStyle,
  type ModChoice,
  type Mode,
  type RangeFilters,
  type SortKey,
  type SortRule,
} from "@osu-pp/shared";
import { AppError } from "./errors";
import { tr } from "./locale";

const MODES = new Set<Mode>(["osu", "taiko", "catch", "mania"]);

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("invalid", tr("request.invalid"), 400);
  }
  return body as Record<string, unknown>;
}

function readMode(value: unknown): Mode | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string" || !MODES.has(value as Mode)) {
    throw new AppError("invalid", tr("request.mode"), 400);
  }
  return value as Mode;
}

function readMods(value: unknown): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 12 || value.some((mod) => typeof mod !== "string")) {
    throw new AppError("invalid", tr("request.mods"), 400);
  }
  return value;
}

function readClock(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AppError("invalid", tr("mods.rateInvalid"), 400);
  }
  return value;
}

function readAccuracy(value: unknown): number {
  const accuracy = value == null ? 100 : value;
  if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100) {
    throw new AppError("invalid", tr("request.accuracy"), 400);
  }
  return accuracy;
}

function readMisses(value: unknown): number {
  const misses = value == null ? 0 : value;
  if (typeof misses !== "number" || !Number.isInteger(misses) || misses < 0) {
    throw new AppError("invalid", tr("request.misses"), 400);
  }
  return misses;
}

function readCombo(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AppError("invalid", tr("request.combo"), 400);
  }
  return value;
}

function readPlay(body: Record<string, unknown>): Omit<CalculateRequest, "beatmapId"> {
  const accuracy = readAccuracy(body.accuracy);
  const misses = readMisses(body.misses);
  if (accuracy === 100 && misses > 0) {
    throw new AppError("invalid", tr("request.ssMisses"), 400);
  }
  return {
    mode: readMode(body.mode),
    mods: readMods(body.mods),
    clockRate: readClock(body.clockRate),
    accuracy,
    combo: readCombo(body.combo),
    misses,
  };
}

export function parseCalculate(body: unknown): CalculateRequest {
  const record = objectBody(body);
  const beatmapId = record.beatmapId;
  if (typeof beatmapId !== "number" || !validId(beatmapId)) {
    throw new AppError("invalid", tr("request.beatmap"), 400);
  }
  return { beatmapId, ...readPlay(record) };
}

function readFilters(value: unknown): DiscoverRequest["mods"] {
  const filters = emptyFilters();
  if (value == null) return filters;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("invalid", tr("request.modChoice"), 400);
  }
  const row = value as Record<string, unknown>;
  for (const mod of FINDER_MODS) {
    const choice = row[mod];
    if (choice == null) continue;
    if (choice !== "off" && choice !== "on" && choice !== "any") {
      throw new AppError("invalid", tr("request.modChoice"), 400);
    }
    filters[mod as FinderMod] = choice as ModChoice;
  }
  return filters;
}

export function parseDiscover(body: unknown): DiscoverRequest {
  const record = objectBody(body);
  const query = typeof record.query === "string" ? record.query.trim() : "";
  if (query.length > 80) throw new AppError("invalid", tr("request.query", { max: 80 }), 400);
  const mode = readMode(record.mode);
  if (!mode) throw new AppError("invalid", tr("request.needMode"), 400);
  // `styles` is a list of types; the older single `style` field is still read.
  let styles: Exclude<MapStyle, "any">[] = [];
  if (Array.isArray(record.styles)) {
    if (record.styles.length > MAP_STYLES.length || record.styles.some((item) => typeof item !== "string" || item === "any" || !MAP_STYLES.includes(item as MapStyle))) {
      throw new AppError("invalid", tr("request.style"), 400);
    }
    styles = [...new Set(record.styles as Exclude<MapStyle, "any">[])];
  } else if (record.style != null) {
    if (typeof record.style !== "string" || !MAP_STYLES.includes(record.style as MapStyle)) {
      throw new AppError("invalid", tr("request.style"), 400);
    }
    if (record.style !== "any") styles = [record.style as Exclude<MapStyle, "any">];
  }
  const ppMin = record.ppMin;
  const ppMax = record.ppMax;
  if (typeof ppMin !== "number" || typeof ppMax !== "number" || !Number.isFinite(ppMin) || !Number.isFinite(ppMax)) {
    throw new AppError("invalid", tr("request.range"), 400);
  }
  if (ppMin < 0 || ppMax > 5000 || ppMin > ppMax) {
    throw new AppError("invalid", tr("request.rangeBounds"), 400);
  }
  let offset = 0;
  if (record.offset != null) {
    if (typeof record.offset !== "number" || !Number.isInteger(record.offset) || record.offset < 0 || record.offset > 200_000) {
      throw new AppError("invalid", tr("request.invalid"), 400);
    }
    offset = record.offset;
  }
  return {
    query,
    mode,
    styles,
    mods: readFilters(record.mods),
    ppMin,
    ppMax,
    offset,
    sort: readSort(record.sort),
    ranges: readRanges(record.ranges),
  };
}

/** A list of {key, dir} rules, or one of the old single sort names. */
function readSort(value: unknown): SortRule[] {
  if (value == null) return [{ key: "farm", dir: "desc" }];
  if (typeof value === "string") {
    const legacy: Record<string, DiscoverSort> = { pp: "pp-desc", stars: "stars-desc", length: "length-desc" };
    const name = legacy[value] ?? value;
    if (!DISCOVER_SORTS.includes(name as DiscoverSort)) throw new AppError("invalid", tr("request.invalid"), 400);
    return legacySort(name as DiscoverSort);
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SORT_RULES) {
    throw new AppError("invalid", tr("request.invalid"), 400);
  }
  const seen = new Set<SortKey>();
  const rules: SortRule[] = [];
  for (const item of value) {
    const rule = item as { key?: unknown; dir?: unknown } | null;
    if (!rule || typeof rule !== "object" || !SORT_KEYS.includes(rule.key as SortKey) || (rule.dir !== "asc" && rule.dir !== "desc")) {
      throw new AppError("invalid", tr("request.invalid"), 400);
    }
    if (seen.has(rule.key as SortKey)) continue;
    seen.add(rule.key as SortKey);
    rules.push({ key: rule.key as SortKey, dir: rule.dir });
  }
  return rules;
}

const RANGE_LIMITS: Record<(typeof RANGE_KEYS)[number], number> = { stars: 20, bpm: 2000, ar: 13, length: 3600 };

/** Optional bounds; each side may be null. */
function readRanges(value: unknown): RangeFilters {
  const ranges = emptyRanges();
  if (value == null) return ranges;
  if (typeof value !== "object" || Array.isArray(value)) throw new AppError("invalid", tr("request.invalid"), 400);
  const record = value as Record<string, unknown>;
  for (const key of RANGE_KEYS) {
    const raw = record[key];
    if (raw == null) continue;
    const range = raw as { min?: unknown; max?: unknown };
    const bound = (side: unknown): number | null => {
      if (side == null) return null;
      if (typeof side !== "number" || !Number.isFinite(side) || side < 0 || side > RANGE_LIMITS[key]) {
        throw new AppError("invalid", tr("request.filterRange"), 400);
      }
      return side;
    };
    const min = bound(range.min);
    const max = bound(range.max);
    if (min != null && max != null && min > max) throw new AppError("invalid", tr("request.filterRange"), 400);
    ranges[key] = { min, max };
  }
  return ranges;
}

export function parseLookup(body: unknown): LookupRequest {
  const record = objectBody(body);
  const beatmapId = record.beatmapId;
  const beatmapsetId = record.beatmapsetId;
  const parsedId = beatmapId == null ? undefined : beatmapId;
  let parsedSet = beatmapsetId == null ? undefined : beatmapsetId;
  if (parsedId != null && (typeof parsedId !== "number" || !validId(parsedId))) {
    throw new AppError("invalid", tr("request.beatmap"), 400);
  }
  if (parsedSet != null && (typeof parsedSet !== "number" || !validId(parsedSet))) {
    if (typeof parsedId === "number" && validId(parsedId)) parsedSet = undefined;
    else throw new AppError("invalid", tr("request.set"), 400);
  }
  if (parsedId == null && parsedSet == null) {
    throw new AppError("invalid", tr("request.needId"), 400);
  }
  return {
    beatmapId: parsedId,
    beatmapsetId: parsedSet,
    ...readPlay(record),
  };
}
