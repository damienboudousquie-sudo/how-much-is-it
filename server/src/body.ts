import {
  FINDER_MODS,
  DISCOVER_SORTS,
  MAP_STYLES,
  emptyFilters,
  validId,
  type CalculateRequest,
  type DiscoverRequest,
  type DiscoverSort,
  type FinderMod,
  type LookupRequest,
  type MapStyle,
  type ModChoice,
  type Mode,
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
  const style = record.style;
  if (typeof style !== "string" || !MAP_STYLES.includes(style as MapStyle)) {
    throw new AppError("invalid", tr("request.style"), 400);
  }
  const ppMin = record.ppMin;
  const ppMax = record.ppMax;
  if (typeof ppMin !== "number" || typeof ppMax !== "number" || !Number.isFinite(ppMin) || !Number.isFinite(ppMax)) {
    throw new AppError("invalid", tr("request.range"), 400);
  }
  if (ppMin < 0 || ppMax > 2000 || ppMin > ppMax) {
    throw new AppError("invalid", tr("request.rangeBounds"), 400);
  }
  let offset = 0;
  if (record.offset != null) {
    if (typeof record.offset !== "number" || !Number.isInteger(record.offset) || record.offset < 0 || record.offset > 200_000) {
      throw new AppError("invalid", tr("request.invalid"), 400);
    }
    offset = record.offset;
  }
  const legacy: Record<string, DiscoverSort> = { pp: "pp-desc", stars: "stars-desc", length: "length-desc" };
  const raw = record.sort == null ? "pp-desc" : record.sort;
  const sort = typeof raw === "string" && raw in legacy ? legacy[raw] : raw;
  if (typeof sort !== "string" || !DISCOVER_SORTS.includes(sort as DiscoverSort)) {
    throw new AppError("invalid", tr("request.invalid"), 400);
  }
  return {
    query,
    mode,
    style: style as MapStyle,
    mods: readFilters(record.mods),
    ppMin,
    ppMax,
    offset,
    sort: sort as DiscoverSort,
  };
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
