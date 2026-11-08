import {
  apiMode,
  normalizeStatus,
  type BeatmapStatus,
  type DifficultyChip,
  type Mode,
  type SearchHit,
} from "@osu-pp/shared";
import { AppError } from "./errors";
import { tr } from "./locale";
import { Lru } from "./lru";
import { recordPlays } from "./popularity";

const API = "https://osu.ppy.sh/api/v2";
const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
/** Beatmap mirrors, tried in order. catboy refuses some cloud hosts, so osu.direct comes first. */
const MIRRORS = ["https://osu.direct/api/v2", "https://catboy.best/api/v2"];
let preferredMirror = 0;

export interface RemoteBeatmap {
  id: number;
  version: string;
  mode: Mode;
  stars: number | null;
  status: BeatmapStatus;
  totalLength: number | null;
  /** Plays on this difficulty, when the source gives it. */
  playcount: number | null;
}

export interface RemoteSet {
  id: number;
  title: string;
  artist: string;
  creator: string;
  status: BeatmapStatus;
  cover: string | null;
  tags: string;
  playCount: number | null;
  beatmaps: RemoteBeatmap[];
}

interface Token {
  access: string;
  expiresAt: number;
}

let token: Token | null = null;
let limitedUntil = 0;
const searchCache = new Lru<{ at: number; hits: SearchHit[] }>(200);
const setCache = new Lru<{ at: number; set: RemoteSet }>(500);

const STATUS_RANK: Record<BeatmapStatus, number> = {
  ranked: 0,
  approved: 1,
  qualified: 2,
  loved: 3,
  pending: 4,
  wip: 5,
  unknown: 6,
  graveyard: 7,
};

export function apiKeyConfigured(): boolean {
  return Boolean(process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET);
}

/** osu! API numeric status, used when the text one is missing. */
const NUMERIC_STATUS: Record<string, string> = { "-2": "graveyard", "-1": "wip", "0": "pending", "1": "ranked", "2": "approved", "3": "qualified", "4": "loved" };

function readStatus(row: Record<string, unknown>): ReturnType<typeof normalizeStatus> {
  const text = normalizeStatus(typeof row.status === "string" ? row.status : null);
  if (text !== "unknown") return text;
  const numeric = typeof row.ranked === "number" ? row.ranked : typeof row.status === "number" ? row.status : null;
  return numeric != null ? normalizeStatus(NUMERIC_STATUS[String(numeric)] ?? null) : "unknown";
}

function coverFor(setId: number, cover: unknown): string | null {
  if (cover && typeof cover === "object" && "cover" in cover && typeof cover.cover === "string") {
    return cover.cover;
  }
  if (setId > 0) return `https://assets.ppy.sh/beatmaps/${setId}/covers/cover.jpg`;
  return null;
}

function readBeatmaps(value: unknown): RemoteBeatmap[] {
  if (!Array.isArray(value)) return [];
  const beatmaps: RemoteBeatmap[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = row.id;
    const mode = apiMode(typeof row.mode === "string" ? row.mode : null);
    if (typeof id !== "number" || !mode) continue;
    beatmaps.push({
      id,
      version: typeof row.version === "string" ? row.version : "Difficulty",
      mode,
      stars: typeof row.difficulty_rating === "number" ? row.difficulty_rating : null,
      status: readStatus(row),
      totalLength: typeof row.total_length === "number" ? row.total_length : null,
      playcount: typeof row.playcount === "number" ? row.playcount : null,
    });
  }
  beatmaps.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  return beatmaps;
}

function readSet(value: unknown): RemoteSet | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "number") return null;
  return {
    id: row.id,
    title: typeof row.title === "string" ? row.title : "Untitled",
    artist: typeof row.artist === "string" ? row.artist : "Unknown artist",
    creator: typeof row.creator === "string" ? row.creator : "Unknown creator",
    status: readStatus(row),
    cover: coverFor(row.id, row.covers),
    tags: typeof row.tags === "string" ? row.tags : "",
    playCount: typeof row.play_count === "number" ? row.play_count : null,
    beatmaps: readBeatmaps(row.beatmaps),
  };
}

function remember(set: RemoteSet): void {
  setCache.set(String(set.id), { at: Date.now(), set });
  recordPlays(set.id, set.beatmaps);
}

function readSets(value: unknown): RemoteSet[] {
  const rows = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { beatmapsets?: unknown }).beatmapsets)
      ? (value as { beatmapsets: unknown[] }).beatmapsets
      : [];
  const sets: RemoteSet[] = [];
  for (const item of rows) {
    const set = readSet(item);
    if (!set || set.beatmaps.length === 0) continue;
    remember(set);
    sets.push(set);
  }
  sets.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  return sets;
}

async function mirrorOnce(base: string, path: string, signal?: AbortSignal): Promise<Response | null> {
  const timeout = AbortSignal.timeout(8_000);
  const signals = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(`${base}${path}`, {
      headers: { Accept: "application/json", "User-Agent": "how-much-is-it (osu! pp finder)" },
      signal: signals,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/** Asks each mirror in turn, starting with the last one that answered. */
async function mirrorGet(path: string, signal?: AbortSignal): Promise<unknown> {
  let missing = 0;
  let limited = 0;
  for (let step = 0; step < MIRRORS.length; step += 1) {
    const index = (preferredMirror + step) % MIRRORS.length;
    const base = MIRRORS[index]!;
    const response = await mirrorOnce(base, path, signal);
    if (!response) {
      console.warn(`[mirror] ${base}${path} did not answer`);
      continue;
    }
    if (response.ok) {
      try {
        const json = await response.json();
        preferredMirror = index;
        return json;
      } catch {
        console.warn(`[mirror] ${base}${path} sent invalid JSON`);
        continue;
      }
    }
    if (response.status === 404) missing += 1;
    else if (response.status === 429) limited += 1;
    else console.warn(`[mirror] ${base}${path} answered ${response.status}`);
  }
  if (missing > 0) throw new AppError("not_found", tr("map.missing"), 404);
  if (limited > 0) throw new AppError("rate_limited", tr("search.limited"), 429);
  throw new AppError("unavailable", tr("search.unavailable"), 502);
}

async function getToken(): Promise<string> {
  if (!apiKeyConfigured()) {
    throw new AppError(
      "api_key_missing",
      tr("search.osuDenied"),
      400,
    );
  }
  if (token && token.expiresAt > Date.now() + 30_000) return token.access;

  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: process.env.OSU_CLIENT_ID ?? "",
        client_secret: process.env.OSU_CLIENT_SECRET ?? "",
        grant_type: "client_credentials",
        scope: "public",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AppError("unavailable", tr("search.osuDown"), 502);
  }

  if (!response.ok) {
    throw new AppError("unavailable", tr("search.osuDenied"), 502);
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || !json.expires_in) {
    throw new AppError("unavailable", tr("search.osuDown"), 502);
  }
  token = { access: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.access;
}

async function apiGet(path: string, signal?: AbortSignal): Promise<unknown> {
  if (Date.now() < limitedUntil) {
    const seconds = Math.max(1, Math.ceil((limitedUntil - Date.now()) / 1000));
    throw new AppError("rate_limited", tr("search.osuWait", { seconds }), 429);
  }

  const access = await getToken();
  const timeout = AbortSignal.timeout(10_000);
  const signals = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${access}`,
      },
      signal: signals,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AppError("unavailable", tr("search.osuDown"), 502);
  }

  if (response.status === 401) {
    token = null;
    throw new AppError("unavailable", tr("search.osuSession"), 502);
  }
  if (response.status === 404) throw new AppError("not_found", tr("map.missing"), 404);
  if (response.status === 429) {
    const retry = Number(response.headers.get("retry-after")) || 2;
    limitedUntil = Date.now() + retry * 1000;
    throw new AppError("rate_limited", tr("search.osuWait", { seconds: retry }), 429);
  }
  if (!response.ok) throw new AppError("unavailable", tr("search.osuDown"), 502);
  return response.json();
}

export async function getBeatmapset(id: number, signal?: AbortSignal): Promise<RemoteSet> {
  const cached = setCache.get(String(id));
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.set;

  if (apiKeyConfigured()) {
    try {
      const json = await apiGet(`/beatmapsets/${id}`, signal);
      const set = readSet(json);
      if (!set) throw new AppError("unavailable", tr("search.bad"), 502);
      remember(set);
      return set;
    } catch (error) {
      if (error instanceof AppError && error.code === "not_found") throw error;
      if (signal?.aborted) throw error;
    }
  }

  let json: unknown;
  try {
    json = await mirrorGet(`/s/${id}`, signal);
  } catch (error) {
    // One quick retry: the mirror sometimes drops a request, and without the set the page shows no status.
    if (signal?.aborted || (error instanceof AppError && error.code === "not_found")) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    json = await mirrorGet(`/s/${id}`, signal);
  }
  const set = readSet(json);
  if (!set) throw new AppError("unavailable", tr("search.bad"), 502);
  remember(set);
  return set;
}

export function pickBeatmap(set: RemoteSet): RemoteBeatmap {
  const ranked = set.beatmaps.filter((beatmap) => beatmap.status === "ranked" || beatmap.status === "approved");
  const pool = ranked.length > 0 ? ranked : set.beatmaps;
  const picked = pool[0];
  if (!picked) throw new AppError("not_found", tr("map.emptySet"), 404);
  return picked;
}

/**
 * Ranked sets first, then the ones whose title or artist holds every word typed,
 * then the most played: "freedom dive" should open on the set everybody plays.
 */
function bestFirst(sets: RemoteSet[], query: string): RemoteSet[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const fits = (set: RemoteSet) => {
    const text = `${set.title} ${set.artist}`.toLowerCase();
    return words.every((word) => text.includes(word)) ? 0 : 1;
  };
  const tier = (set: RemoteSet) => (STATUS_RANK[set.status] <= 1 ? 0 : STATUS_RANK[set.status] <= 3 ? 1 : 2);
  return [...sets].sort(
    (a, b) => tier(a) - tier(b) || fits(a) - fits(b) || (b.playCount ?? 0) - (a.playCount ?? 0),
  );
}

function toHits(sets: RemoteSet[], limit: number): SearchHit[] {
  return sets.slice(0, limit).map((set) => ({
    beatmapsetId: set.id,
    title: set.title,
    artist: set.artist,
    creator: set.creator,
    status: set.status,
    // Small thumbnail for the dropdown; the beatmap page keeps the large cover.
    cover: `https://assets.ppy.sh/beatmaps/${set.id}/covers/card.jpg`,
    beatmaps: set.beatmaps.map(toChip),
  }));
}

const RANKED = new Set(["ranked", "approved"]);

/** Keeps ranked and approved sets, and only their ranked difficulties. */
function rankedOnly(sets: RemoteSet[]): RemoteSet[] {
  return sets
    .filter((set) => RANKED.has(set.status) || set.beatmaps.some((beatmap) => RANKED.has(beatmap.status)))
    .map((set) => ({ ...set, beatmaps: set.beatmaps.filter((beatmap) => RANKED.has(beatmap.status)) }))
    .filter((set) => set.beatmaps.length > 0);
}

export async function searchBeatmaps(query: string, signal?: AbortSignal, ranked = false): Promise<SearchHit[]> {
  const key = `${ranked ? "ranked" : "any"}\n${query.trim()}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < 20_000) return cached.hits;

  let sets: RemoteSet[] = [];
  if (apiKeyConfigured()) {
    try {
      const params = new URLSearchParams({ q: query.trim(), s: ranked ? "ranked" : "any" });
      const json = (await apiGet(`/beatmapsets/search?${params}`, signal)) as { beatmapsets?: unknown };
      sets = readSets(json.beatmapsets);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!(error instanceof AppError)) throw error;
    }
  }
  if (sets.length === 0) {
    const params = new URLSearchParams({ query: query.trim(), amount: "50" });
    sets = readSets(await mirrorGet(`/search?${params}`, signal));
  }
  const hits = toHits(bestFirst(ranked ? rankedOnly(sets) : sets, query), 8);
  searchCache.set(key, { at: Date.now(), hits });
  return hits;
}

function toChip(beatmap: RemoteBeatmap): DifficultyChip {
  return {
    id: beatmap.id,
    version: beatmap.version,
    mode: beatmap.mode,
    stars: beatmap.stars,
    status: beatmap.status,
  };
}

export function chipsFrom(set: RemoteSet): DifficultyChip[] {
  return set.beatmaps.map(toChip);
}
