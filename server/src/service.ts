import {
  compareDiscover,
  emptyRanges,
  farmScores,
  inRange,
  guessedScores,
  matchesAnyStyle,
  modRate,
  matchingCombos,
  modsInCombo,
  primaryStyle,
  streamPurity,
  styleScores,
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
  type StyleScores,
} from "@osu-pp/shared";
import { loadBeatmapFile } from "./beatmapCache";
import { AppError } from "./errors";
import { parseOsuText } from "./osuFile";
import { popularityOf, readPopularity, setPopularityFetcher } from "./popularity";
import { apiKeyConfigured, chipsFrom, getBeatmapset, pickBeatmap, searchBeatmaps, type RemoteSet } from "./osuApi";
import { tr } from "./locale";
import { analyzeLater, analyzeNow, getProfile, rememberProfile } from "./patternStore";
import { coverFor, loadRangeMaps, loadTextMaps, type PpDbMap } from "./ppDb";
import { calculatePlay } from "./pp";

export async function search(query: string, signal?: AbortSignal, ranked = false): Promise<SearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) return { results: [], apiKeyConfigured: apiKeyConfigured(), message: null };
  if (trimmed.length > 100) {
    throw new AppError("invalid", tr("request.query", { max: 100 }), 400);
  }
  try {
    const results = await searchBeatmaps(trimmed, signal, ranked);
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

async function remoteSet(id: number, warnings: string[]): Promise<RemoteSet | null> {
  try {
    return await getBeatmapset(id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "rate_limited" || error.code === "unavailable" || error.code === "not_found")) {
      warnings.push(error.code === "not_found" ? tr("map.missing") : error.message);
      return null;
    }
    throw error;
  }
}

/** Warms the .osu file and the set so a click right after a hover opens instantly. */
export function prefetch(beatmapId: number, beatmapsetId: number | null): void {
  void loadBeatmapFile(beatmapId)
    .then((file) => {
      const setId = beatmapsetId ?? parseOsuText(file.text).beatmapsetId;
      if (setId) return getBeatmapset(setId).then(() => undefined);
    })
    .catch(() => undefined);
}

export type Timing = Record<string, number>;

async function timed<T>(timing: Timing | undefined, name: string, job: Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await job;
  } finally {
    if (timing) timing[name] = performance.now() - start;
  }
}

export async function lookup(input: LookupRequest, timing?: Timing): Promise<LookupResponse> {
  const warnings: string[] = [];
  let beatmapId = input.beatmapId;
  let remotePromise: Promise<RemoteSet | null> | null = null;

  if (beatmapId == null) {
    const remote = await getBeatmapset(input.beatmapsetId as number);
    beatmapId = pickBeatmap(remote).id;
    remotePromise = Promise.resolve(remote);
  } else if (input.beatmapsetId != null) {
    // The set id is known: fetch the set and the .osu file at the same time.
    remotePromise = timed(timing, "set", remoteSet(input.beatmapsetId, warnings));
  }

  const file = await timed(timing, "file", loadBeatmapFile(beatmapId));
  const local = parseOsuText(file.text);
  const setId = input.beatmapsetId ?? local.beatmapsetId;
  if (!remotePromise && setId) remotePromise = timed(timing, "set", remoteSet(setId, warnings));

  const [remote, play] = await Promise.all([
    remotePromise ?? Promise.resolve(null),
    timed(timing, "calc", calculatePlay({ ...input, beatmapId }, local.mode, local.endMs, true)),
  ]);
  const current = remote?.beatmaps.find((beatmap) => beatmap.id === beatmapId);
  if (current?.totalLength != null && play.clockRate > 0) {
    play.stats.lengthSeconds = current.totalLength / play.clockRate;
  }

  const pattern = local.mode === "osu" ? rememberProfile(beatmapId, file.text) : null;
  const meta = buildMeta(beatmapId, local, remote, play.stats.stars, play.mode);
  return {
    meta,
    stats: play.stats,
    curve: play.curve,
    score: play.score,
    warnings: [...play.warnings, ...warnings],
    pattern,
    styles: pattern ? styleScores(pattern, { version: meta.version }) : null,
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

/* ---------- discover ---------- */

setPopularityFetcher((setId) => getBeatmapset(setId));

const PAGE = 60;
/** Maps read before answering: the page asked for and the next one. */
const REFINE_WINDOW = PAGE * 2;
/** Short: answers must stay fast. The client asks again while maps are being read. */
const REFINE_BUDGET_MS = 600;
/** Maps read in the background after answering, so scrolling and later searches are exact. */
const BACKGROUND_WINDOW = 500;

interface Candidate {
  map: PpDbMap;
  scores: StyleScores;
  known: boolean;
  farm: number;
}

function purityOf(beatmapId: number): number | null {
  const profile = getProfile(beatmapId);
  return profile ? streamPurity(profile) : null;
}

function scoresFor(map: PpDbMap, osu: boolean): { scores: StyleScores; known: boolean } {
  if (!osu) return { scores: guessedScores(null), known: false };
  const profile = getProfile(map.beatmapId);
  if (profile) return { scores: styleScores(profile, { version: map.version }, modRate(modsInCombo(map.mods))), known: true };
  if (profile === null) return { scores: guessedScores(map.guess), known: true };
  return { scores: guessedScores(map.guess), known: false };
}

/**
 * Known maps must really be of the type. Before reading, every unknown map is a candidate
 * (metadata alone mistakes 1/2 jump maps for streams); once shown, an unknown map needs its
 * metadata guess to agree.
 */
function keep(candidate: Candidate, input: DiscoverRequest, strict: boolean): boolean {
  if (input.styles.length === 0) return true;
  if (candidate.known) return matchesAnyStyle(candidate.scores, input.styles);
  return strict ? candidate.map.guess != null && input.styles.includes(candidate.map.guess) : true;
}

function rank(list: Candidate[], input: DiscoverRequest): Candidate[] {
  const farms = farmScores(
    list.map((item) => ({
      pp: item.map.pp,
      stars: item.map.stars,
      lengthSeconds: item.map.lengthSeconds,
      hint: item.map.hint,
      scores: item.scores,
      purity: purityOf(item.map.beatmapId),
      popularity: popularityOf(item.map.beatmapId),
    })),
    input.styles,
  );
  list.forEach((item, index) => {
    item.farm = farms[index]!;
  });
  return list.sort((a, b) =>
    compareDiscover(input.sort, { ...a.map, farm: a.farm }, { ...b.map, farm: b.farm }),
  );
}

function toHit(item: Candidate, input: DiscoverRequest): DiscoverHit {
  const map = item.map;
  return {
    beatmapId: map.beatmapId,
    beatmapsetId: map.beatmapsetId,
    title: map.title,
    artist: map.artist,
    creator: map.creator,
    version: map.version,
    mode: input.mode,
    status: "ranked",
    cover: coverFor(map.beatmapsetId),
    stars: map.stars,
    pp: map.pp,
    lengthSeconds: map.lengthSeconds,
    bpm: map.bpm,
    ar: map.ar,
    mods: modsInCombo(map.mods),
    style: input.mode === "osu" ? (item.known ? primaryStyle(item.scores) : map.guess) : null,
    farm: item.farm,
    estimated: input.mode === "osu" && !item.known,
  };
}

async function loadCombos(input: DiscoverRequest, combos: string[]) {
  const query = input.query.trim();
  const settled = await Promise.allSettled(
    combos.map(async (mods) => {
      if (query) {
        const maps = await loadTextMaps({ query, mode: input.mode, mods });
        return { maps, limitedFrom: null as number | null, loaded: maps.length, expected: maps.length, complete: true };
      }
      return loadRangeMaps({ mode: input.mode, mods, ppMin: input.ppMin, ppMax: input.ppMax });
    }),
  );
  if (settled.every((result) => result.status === "rejected")) throw new AppError("unavailable", tr("ppdb.down"), 502);
  const maps: PpDbMap[] = [];
  let limitedFrom: number | null = null;
  let loaded = 0;
  let expected = 0;
  let complete = true;
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    maps.push(...result.value.maps);
    loaded += result.value.loaded;
    expected += result.value.expected;
    complete = complete && result.value.complete;
    if (result.value.limitedFrom != null) limitedFrom = Math.max(limitedFrom ?? 0, result.value.limitedFrom);
  }
  return { maps, limitedFrom, catalog: complete ? null : { loaded, expected: Math.max(expected, loaded) } };
}

export async function discover(input: DiscoverRequest, signal?: AbortSignal): Promise<DiscoverResponse> {
  const osu = input.mode === "osu";
  const styleIgnored = !osu && input.styles.length > 0;
  const effective: DiscoverRequest = styleIgnored ? { ...input, styles: [] } : input;
  const combos = matchingCombos(input.mods);
  const empty = { results: [], scanned: 0, total: 0, hasMore: false, nextOffset: 0, styleIgnored, analyzing: 0, limitedFrom: null, catalog: null };
  if (combos.length > 8) return { ...empty, notice: "too_many" };

  const { maps, limitedFrom, catalog } = await loadCombos(effective, combos);
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

  const query = effective.query.trim();
  const seen = new Set<string>();
  let pool: Candidate[] = [];
  for (const map of maps) {
    if (map.pp < effective.ppMin || map.pp > effective.ppMax) continue;
    if (query && !textMatches(query, [map.title, map.artist, map.creator, map.version])) continue;
    const ranges = effective.ranges;
    if (!inRange(map.stars, ranges.stars) || !inRange(map.bpm, ranges.bpm) || !inRange(map.ar, ranges.ar) || !inRange(map.lengthSeconds, ranges.length)) continue;
    const key = `${map.beatmapId}:${map.mods}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pool.push({ map, ...scoresFor(map, osu), farm: 0 });
  }

  // Exact types and farm ranking need the hit objects. Read the maps that would be shown first.
  const refine = osu && (effective.styles.length > 0 || effective.sort.some((rule) => rule.key === "farm"));
  let analyzing = 0;
  if (refine) {
    let ranked = rank(pool.filter((item) => keep(item, effective, false)), effective);
    const unknownIds = (list: Candidate[]) => [...new Set(list.filter((item) => !item.known).map((item) => item.map.beatmapId))];
    // Reading maps reorders the list and pulls new unknown maps into view: repeat while time remains.
    const deadline = Date.now() + REFINE_BUDGET_MS;
    for (let round = 0; round < 2; round += 1) {
      const front = unknownIds(ranked.slice(0, effective.offset + REFINE_WINDOW));
      const left = deadline - Date.now();
      if (front.length === 0 || left < 150) break;
      await analyzeNow(front, left, signal);
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      pool = pool.map((item) => (item.known ? item : { ...item, ...scoresFor(item.map, osu) }));
      ranked = rank(pool.filter((item) => keep(item, effective, false)), effective);
    }
    const window = ranked.slice(0, effective.offset + REFINE_WINDOW);
    // Play counts for the maps in view; the client polls while they arrive.
    const unread = readPopularity(new Set(window.flatMap((item) => (item.map.beatmapsetId ? [item.map.beatmapsetId] : []))));
    analyzing = unknownIds(window).length + unread;
    analyzeLater(unknownIds(ranked.slice(0, effective.offset + BACKGROUND_WINDOW)));
  }

  const matched = rank(pool.filter((item) => keep(item, effective, true)), effective);
  const slice = matched.slice(effective.offset, effective.offset + PAGE);
  const nextOffset = effective.offset + slice.length;
  return {
    results: slice.map((item) => toHit(item, effective)),
    scanned: maps.length,
    total: matched.length,
    hasMore: nextOffset < matched.length,
    nextOffset,
    notice: matched.length === 0 ? (analyzing > 0 || catalog ? "preview" : "none") : "preview",
    styleIgnored,
    analyzing,
    limitedFrom,
    catalog,
  };
}

/** Fills the caches for the page shown on first visit. */
export function warmFinderIndex(): void {
  void discover({
    query: "",
    mode: "osu",
    styles: [],
    mods: { EZ: "off", HD: "off", HR: "off", DT: "off", HT: "off", FL: "off" },
    ppMin: 500,
    ppMax: 600,
    offset: 0,
    sort: [{ key: "farm", dir: "desc" }],
    ranges: emptyRanges(),
  }).catch(() => undefined);
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
    cover: remote?.cover ?? coverFor(setId, "cover"),
    difficulties,
  };
}
