import {
  STYLE_QUERY,
  classifyStyle,
  matchingCombos,
  modsInCombo,
  profileNote,
  textMatches,
  type CalculateRequest,
  type CalculateResponse,
  type DifficultyChip,
  type DiscoverHit,
  type DiscoverRequest,
  type DiscoverResponse,
  type LookupRequest,
  type LookupResponse,
  type MapMeta,
  type SearchResponse,
} from "@osu-pp/shared";
import { loadBeatmapFile } from "./beatmapCache";
import { AppError } from "./errors";
import { parseOsuText } from "./osuFile";
import {
  apiKeyConfigured,
  chipsFrom,
  getBeatmapset,
  pickBeatmap,
  searchBeatmaps,
  type RemoteSet,
} from "./osuApi";
import { tr } from "./locale";
import { loadTextMaps, searchPpMaps, type PpDbMap } from "./ppDb";
import { calculatePlay } from "./pp";

export async function search(query: string, signal?: AbortSignal): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], apiKeyConfigured: apiKeyConfigured(), message: null };
  if (trimmed.length > 100) {
    throw new AppError("invalid", tr("request.query", { max: 100 }), 400);
  }
  try {
    const results = await searchBeatmaps(trimmed, signal);
    return {
      results,
      apiKeyConfigured: apiKeyConfigured(),
      message: results.length > 0 ? null : tr("search.none"),
    };
  } catch (error) {
    if (error instanceof AppError && error.code === "rate_limited") {
      return { results: [], apiKeyConfigured: apiKeyConfigured(), message: error.message };
    }
    throw error;
  }
}

export async function lookup(input: LookupRequest): Promise<LookupResponse> {
  let beatmapId = input.beatmapId;
  let remote: RemoteSet | null = null;
  const warnings: string[] = [];

  if (beatmapId == null) {
    remote = await getBeatmapset(input.beatmapsetId as number);
    beatmapId = pickBeatmap(remote).id;
  }

  const file = await loadBeatmapFile(beatmapId);
  const local = parseOsuText(file.text);
  const setId = input.beatmapsetId ?? local.beatmapsetId;

  if (!remote && setId) {
    try {
      remote = await getBeatmapset(setId);
    } catch (error) {
      if (error instanceof AppError && (error.code === "rate_limited" || error.code === "unavailable" || error.code === "not_found")) {
        warnings.push(error.code === "not_found" ? tr("map.missing") : error.message);
      } else {
        throw error;
      }
    }
  }

  const play = await calculatePlay({ ...input, beatmapId }, local.mode, local.endMs, true);
  const current = remote?.beatmaps.find((beatmap) => beatmap.id === beatmapId);
  if (current?.totalLength != null && play.clockRate > 0) {
    play.stats.lengthSeconds = current.totalLength / play.clockRate;
  }

  const meta = buildMeta(beatmapId, local, remote, play.stats.stars, play.mode);
  return {
    meta,
    stats: play.stats,
    curve: play.curve,
    score: play.score,
    warnings: [...play.warnings, ...warnings],
    profileNote: profileNote(meta.status),
    apiKeyConfigured: apiKeyConfigured(),
  };
}

export async function calculate(input: CalculateRequest): Promise<CalculateResponse> {
  const file = await loadBeatmapFile(input.beatmapId);
  const local = parseOsuText(file.text);
  const play = await calculatePlay(input, local.mode, local.endMs);
  return {
    mode: play.mode,
    stats: play.stats,
    curve: play.curve,
    score: play.score,
    warnings: play.warnings,
  };
}

const PAGE = 100;
const CAP = 150;

function inRange(map: PpDbMap, input: DiscoverRequest): boolean {
  return map.pp >= input.ppMin && map.pp <= input.ppMax && textMatches(input.query, [map.title, map.artist, map.creator, map.version]);
}

function toHit(map: PpDbMap, input: DiscoverRequest): DiscoverHit {
  return {
    beatmapId: map.beatmapId,
    beatmapsetId: map.beatmapsetId,
    title: map.title,
    artist: map.artist,
    creator: map.creator,
    version: map.version,
    mode: input.mode,
    status: "ranked",
    cover: map.cover,
    stars: map.stars,
    pp: map.pp,
    lengthSeconds: map.lengthSeconds,
    mods: modsInCombo(map.mods),
    style: input.mode === "osu" ? classifyStyle({ tags: `${map.title} ${map.artist}`, version: map.version }) : null,
  };
}

async function collectByText(mods: string, input: DiscoverRequest, query: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
  let maps: PpDbMap[];
  try {
    maps = await loadTextMaps({ query, mode: input.mode, mods });
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    return null;
  }
  const matched = maps.filter((map) => inRange(map, input)).sort((a, b) => b.pp - a.pp);
  const start = input.offset;
  const slice = matched.slice(start, start + 300);
  return {
    hits: slice.map((map) => toHit(map, input)),
    scanned: maps.length,
    total: matched.length,
    nextOffset: start + slice.length,
    hasMore: start + slice.length < matched.length,
  };
}

export function warmFinderIndex(): void {
  void Promise.all(
    Object.values(STYLE_QUERY).map((query) => loadTextMaps({ query, mode: "osu", mods: "NM" }).catch(() => undefined)),
  );
}

async function collectCombo(mods: string, input: DiscoverRequest, styleIgnored: boolean, signal?: AbortSignal) {
  const styleWord = !styleIgnored && input.style !== "any" ? STYLE_QUERY[input.style] : "";
  const userQuery = input.query.trim();
  const text = userQuery && styleWord.includes(" OR ") ? `(${userQuery}) AND (${styleWord})` : [userQuery, styleWord].filter(Boolean).join(" ");
  if (text) return collectByText(mods, input, text, signal);

  const start = input.offset;
  const offsets = [start];
  const pages = await Promise.all(
    offsets.map(async (offset) => {
      try {
        return await searchPpMaps(
          { mode: input.mode, mods, ppMin: input.ppMin, ppMax: input.ppMax, limit: PAGE, offset },
          signal,
        );
      } catch (error) {
        if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
        return null;
      }
    }),
  );
  if (pages.every((page) => page == null)) return null;

  const hits: DiscoverHit[] = [];
  let scanned = 0;
  let total = 0;
  let cursor = start;
  let reachedEnd = false;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    if (!page) break;
    total = page.total;
    const pageOffset = offsets[index] ?? start;
    if (page.maps.length === 0) {
      cursor = pageOffset;
      reachedEnd = true;
      break;
    }
    for (let mapIndex = 0; mapIndex < page.maps.length; mapIndex++) {
      const map = page.maps[mapIndex];
      if (!map) continue;
      scanned += 1;
      cursor = pageOffset + mapIndex + 1;
      if (inRange(map, input)) hits.push(toHit(map, input));
      if (hits.length >= CAP) {
        return { hits, scanned, total, nextOffset: cursor, hasMore: cursor < page.total };
      }
    }
    cursor = pageOffset + page.maps.length;
    if (cursor >= page.total) {
      reachedEnd = true;
      break;
    }
  }
  return { hits, scanned, total, nextOffset: cursor, hasMore: !reachedEnd && cursor < total };
}

export async function discover(input: DiscoverRequest, signal?: AbortSignal): Promise<DiscoverResponse> {
  const styleIgnored = input.mode !== "osu" && input.style !== "any";
  const combos = matchingCombos(input.mods);
  if (combos.length > 8) {
    return { results: [], scanned: 0, total: 0, hasMore: false, nextOffset: 0, notice: "too_many", styleIgnored };
  }

  const lists = await Promise.all(combos.map((mods) => collectCombo(mods, input, styleIgnored, signal)));
  if (lists.every((list) => list == null)) throw new AppError("unavailable", tr("ppdb.down"), 502);

  const seen = new Set<string>();
  const results: DiscoverHit[] = [];
  let scanned = 0;
  let total = 0;
  let nextOffset = input.offset;
  let hasMore = false;
  for (const list of lists) {
    if (!list) continue;
    scanned += list.scanned;
    total += list.total;
    nextOffset = Math.max(nextOffset, list.nextOffset);
    hasMore = hasMore || list.hasMore;
    for (const hit of list.hits) {
      const key = `${hit.beatmapId}:${hit.mods.join("")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(hit);
    }
  }
  results.sort((a, b) => b.pp - a.pp);
  return {
    results,
    scanned,
    total,
    hasMore,
    nextOffset,
    notice: results.length === 0 && !hasMore ? "none" : "preview",
    styleIgnored,
  };
}

function buildMeta(
  beatmapId: number,
  local: ReturnType<typeof parseOsuText>,
  remote: RemoteSet | null,
  stars: number,
  mode: ReturnType<typeof parseOsuText>["mode"],
): MapMeta {
  const fromApi = remote?.beatmaps.find((beatmap) => beatmap.id === beatmapId);
  const status = fromApi?.status ?? remote?.status ?? "unknown";
  const setId = remote?.id ?? local.beatmapsetId;
  let difficulties: DifficultyChip[] = remote ? chipsFrom(remote) : [];
  if (!difficulties.some((chip) => chip.id === beatmapId)) {
    difficulties = [
      {
        id: beatmapId,
        version: fromApi?.version ?? local.version,
        mode,
        stars: fromApi?.stars ?? stars,
        status,
      },
      ...difficulties,
    ];
  }
  return {
    beatmapId,
    beatmapsetId: setId,
    title: remote?.title ?? local.title,
    artist: remote?.artist ?? local.artist,
    creator: remote?.creator ?? local.creator,
    version: fromApi?.version ?? local.version,
    mode,
    status,
    cover: remote?.cover ?? (setId ? `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg` : null),
    difficulties,
  };
}
