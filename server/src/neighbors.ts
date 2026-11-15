import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Mode, TopPlay } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { apiKeyConfigured, appGet, osuLimited } from "./osuApi";

/**
 * "Who plays what", like Tillerinobot: the top plays of thousands of players, collected in
 * the background through the osu! API, and the maps that players with a top like yours
 * (same maps with the same mods, a similar pp level) have and you don't.
 *
 * Players come from random user ids (every rank, not only the top 10,000 that the rankings
 * show) and from the rankings pages; logged-in players are added as they come. A player is
 * fetched again after a week. One API request every 2 s at most, paused while osu! asks us
 * to slow down, so the site itself always keeps its share of the API.
 */

const DIR = join(repoRoot, "cache", "who-plays");
const MODES: Mode[] = ["osu", "taiko", "catch", "mania"];
const API_MODE: Record<Mode, string> = { osu: "osu", taiko: "taiko", catch: "fruits", mania: "mania" };
/** Players kept per mode. */
const TARGET: Record<Mode, number> = { osu: 12000, taiko: 3000, catch: 3000, mania: 3000 };
/** Below this pp a top is too thin to say much. */
const MIN_PP: Record<Mode, number> = { osu: 1000, taiko: 400, catch: 400, mania: 400 };
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const STEP_MS = 2000;
const MAX_USER_ID = 40_000_000;

/** One play: beatmap id, mod combo ("NM", "HD", "HDDT"…), pp. */
type Play = [number, string, number];

interface Player {
  at: number;
  plays: Play[];
}

interface Store {
  players: Map<number, Player>;
  dirty: boolean;
  index: Map<string, { player: number; rank: number }[]> | null;
  level: Map<number, number> | null;
}

const stores = new Map<Mode, Store>();

const PP_MODS = ["EZ", "HD", "HR", "DT", "HT", "FL"];

/** The pp-relevant mod combo of a play, as the recommendations name it. */
export function comboKey(mods: readonly string[]): string {
  const set = new Set(mods.map((mod) => (mod === "NC" ? "DT" : mod)));
  return PP_MODS.filter((mod) => set.has(mod)).join("") || "NM";
}

function fileOf(mode: Mode): string {
  return join(DIR, `${mode}.json`);
}

function store(mode: Mode): Store {
  let kept = stores.get(mode);
  if (kept) return kept;
  kept = { players: new Map(), dirty: false, index: null, level: null };
  try {
    const raw = JSON.parse(readFileSync(fileOf(mode), "utf8")) as { players?: Record<string, Player> };
    for (const [id, player] of Object.entries(raw.players ?? {})) kept.players.set(Number(id), player);
  } catch {
    // First run.
  }
  stores.set(mode, kept);
  return kept;
}

async function save(mode: Mode): Promise<void> {
  const s = store(mode);
  if (!s.dirty) return;
  s.dirty = false;
  mkdirSync(DIR, { recursive: true });
  const tmp = `${fileOf(mode)}.tmp`;
  await writeFile(tmp, JSON.stringify({ v: 1, players: Object.fromEntries(s.players) }));
  await rename(tmp, fileOf(mode));
}

function put(mode: Mode, userId: number, plays: Play[]): void {
  const s = store(mode);
  if (plays.length < 10) {
    if (s.players.delete(userId)) s.dirty = true;
    return;
  }
  s.players.set(userId, { at: Date.now(), plays: plays.slice(0, 100) });
  s.dirty = true;
  s.index = null;
  s.level = null;
}

/** A logged-in player's top, added as it is fetched for the site. */
export function addPlayer(mode: Mode, userId: number, top: readonly TopPlay[]): void {
  const plays = [...top].sort((a, b) => b.pp - a.pp).map((play): Play => [play.beatmapId, comboKey(play.mods), play.pp]);
  put(mode, userId, plays);
}

/** Middle pp of a top 20: the player's level. */
function levelOf(plays: readonly Play[]): number {
  const pps = plays.slice(0, 20).map((play) => play[2]).sort((a, b) => a - b);
  return pps.length ? pps[Math.floor(pps.length / 2)] : 0;
}

function indexOf(s: Store): { index: Map<string, { player: number; rank: number }[]>; level: Map<number, number> } {
  if (s.index && s.level) return { index: s.index, level: s.level };
  const index = new Map<string, { player: number; rank: number }[]>();
  const level = new Map<number, number>();
  for (const [id, player] of s.players) {
    level.set(id, levelOf(player.plays));
    player.plays.forEach(([beatmapId, combo], rank) => {
      const key = `${beatmapId}:${combo}`;
      let list = index.get(key);
      if (!list) index.set(key, (list = []));
      list.push({ player: id, rank });
    });
  }
  s.index = index;
  s.level = level;
  return { index, level };
}

/**
 * For each map + mod combo the player has not played, 0 to 1: how much the players closest
 * to them (top overlap, pp level) have it in their own top. Empty when too few players
 * look alike (new player, rare mods, not enough data yet).
 */
export function neighbourScores(mode: Mode, userId: number, top: readonly TopPlay[]): Map<string, number> {
  const out = new Map<string, number>();
  const s = store(mode);
  if (s.players.size < 200 || top.length < 10) return out;
  const { index, level } = indexOf(s);
  const mine = [...top].sort((a, b) => b.pp - a.pp);
  const myLevel = levelOf(mine.map((play): Play => [play.beatmapId, comboKey(play.mods), play.pp]));
  if (!(myLevel > 0)) return out;

  // Players sharing maps (with the same mods) with the top 50, weighted by where the map
  // sits in both tops, then by how close their level is.
  const sim = new Map<number, number>();
  mine.slice(0, 50).forEach((play, rank) => {
    const list = index.get(`${play.beatmapId}:${comboKey(play.mods)}`);
    if (!list) return;
    const mineWeight = 0.95 ** rank;
    for (const entry of list) {
      if (entry.player === userId) continue;
      sim.set(entry.player, (sim.get(entry.player) ?? 0) + mineWeight * 0.97 ** entry.rank);
    }
  });
  const near = [...sim]
    .map(([player, value]) => {
      const theirs = level.get(player) ?? 0;
      const closeness = theirs > 0 ? Math.exp(-Math.abs(Math.log(theirs / myLevel)) / 0.12) : 0;
      return { player, value: value * closeness };
    })
    .filter((item) => item.value > 0.05)
    .sort((a, b) => b.value - a.value)
    .slice(0, 200);
  if (near.length < 5) return out;

  const played = new Set(mine.map((play) => play.beatmapId));
  const sum = new Map<string, number>();
  for (const { player, value } of near) {
    const plays = s.players.get(player)?.plays ?? [];
    plays.forEach(([beatmapId, combo], rank) => {
      if (played.has(beatmapId)) return;
      const key = `${beatmapId}:${combo}`;
      sum.set(key, (sum.get(key) ?? 0) + value * 0.97 ** rank);
    });
  }
  const best = Math.max(0, ...sum.values());
  if (!(best > 0)) return out;
  for (const [key, value] of [...sum].sort((a, b) => b[1] - a[1]).slice(0, 400)) out.set(key, value / best);
  return out;
}

/* ---------- crawler ---------- */

interface ApiUser {
  id: number;
  statistics_rulesets?: Partial<Record<string, { pp?: number | null } | null>>;
}

interface ApiScore {
  pp?: number | null;
  mods?: ({ acronym: string } | string)[];
  beatmap?: { id: number };
}

const queue: { mode: Mode; userId: number }[] = [];
const queued = new Set<string>();
let step = 0;

function wants(mode: Mode, userId: number): boolean {
  const s = store(mode);
  const kept = s.players.get(userId);
  if (kept) return Date.now() - kept.at > STALE_MS;
  return s.players.size < TARGET[mode];
}

function enqueue(mode: Mode, userId: number): void {
  const key = `${mode}:${userId}`;
  if (queued.has(key) || !wants(mode, userId)) return;
  queued.add(key);
  queue.push({ mode, userId });
}

/** A batch of random user ids: every rank of every mode, not only the top 10,000. */
async function sampleUsers(): Promise<void> {
  const ids = Array.from({ length: 50 }, () => 2 + Math.floor(Math.random() * MAX_USER_ID));
  const query = ids.map((id) => `ids[]=${id}`).join("&");
  const json = (await appGet(`/users?${query}`)) as { users?: ApiUser[] };
  for (const user of json.users ?? []) {
    for (const mode of MODES) {
      const pp = user.statistics_rulesets?.[API_MODE[mode]]?.pp ?? 0;
      if (pp >= MIN_PP[mode]) enqueue(mode, user.id);
    }
  }
}

/** A random rankings page of a mode: the high ranks, rarer among random ids. */
async function sampleRanking(mode: Mode): Promise<void> {
  const page = 1 + Math.floor(Math.random() * 200);
  const json = (await appGet(`/rankings/${API_MODE[mode]}/performance?cursor%5Bpage%5D=${page}`)) as {
    ranking?: { user?: { id?: number } }[];
  };
  for (const row of json.ranking ?? []) if (row.user?.id) enqueue(mode, row.user.id);
}

async function fetchTop(mode: Mode, userId: number): Promise<void> {
  const scores = (await appGet(`/users/${userId}/scores/best?mode=${API_MODE[mode]}&limit=100`)) as ApiScore[];
  const plays = (Array.isArray(scores) ? scores : [])
    .filter((score) => score.beatmap?.id && typeof score.pp === "number")
    .map((score): Play => [score.beatmap!.id, comboKey((score.mods ?? []).map((mod) => (typeof mod === "string" ? mod : mod.acronym))), Math.round(score.pp! * 10) / 10]);
  put(mode, userId, plays);
}

/** The mode furthest from its target, to sample the rankings of. */
function hungriest(): Mode | null {
  let best: Mode | null = null;
  let need = 0;
  for (const mode of MODES) {
    const missing = 1 - store(mode).players.size / TARGET[mode];
    if (missing > need) {
      need = missing;
      best = mode;
    }
  }
  return best;
}

async function tick(): Promise<void> {
  if (osuLimited()) return;
  step++;
  const next = queue.shift();
  if (next) {
    queued.delete(`${next.mode}:${next.userId}`);
    await fetchTop(next.mode, next.userId);
    return;
  }
  // Nothing queued: find more players (or players to refresh).
  const mode = hungriest();
  if (mode && step % 4 === 0) await sampleRanking(mode);
  else if (mode) await sampleUsers();
  else refreshOldest();
}

/** Everyone collected: queue the players not fetched for a week. */
function refreshOldest(): void {
  for (const mode of MODES) {
    const old = [...store(mode).players].filter(([, player]) => Date.now() - player.at > STALE_MS).slice(0, 50);
    for (const [userId] of old) enqueue(mode, userId);
  }
}

let started = false;

export function startNeighbourCrawler(): void {
  if (started || !apiKeyConfigured()) return;
  started = true;
  for (const mode of MODES) store(mode);
  const loop = async () => {
    try {
      await tick();
    } catch {
      // A failed request: the next step tries something else.
    }
    setTimeout(loop, STEP_MS);
  };
  setTimeout(loop, 30_000);
  setInterval(() => {
    for (const mode of MODES) void save(mode).catch(() => undefined);
  }, 5 * 60 * 1000);
}

/** Counts for the health page. */
export function neighbourStats(): Record<string, number> {
  return Object.fromEntries(MODES.map((mode) => [mode, store(mode).players.size]));
}
