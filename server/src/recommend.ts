import {
  emptyRanges,
  modRate,
  ppGain,
  primaryStyle,
  secondaryStyles,
  type ConcreteStyle,
  styleScores,
  type DiscoverHit,
  type DiscoverRequest,
  type RecommendHit,
  type RecommendResponse,
  type TopPlay,
} from "@osu-pp/shared";
import { playerData } from "./account";
import { getProfile } from "./patternStore";
import { calculatePlay } from "./pp";
import { discover } from "./service";

/**
 * Tillerino-style suggestions: farm maps in the pp range of the player's top plays, with
 * the mods and map types they score with, that are not already in their top or marked done.
 */

const PP_MODS = ["EZ", "HD", "HR", "DT", "HT", "FL"] as const;
type ModKey = (typeof PP_MODS)[number];

function comboOf(mods: readonly string[]): ModKey[] {
  const set = new Set(mods.map((mod) => (mod === "NC" ? "DT" : mod === "PF" || mod === "SD" ? "" : mod)));
  return PP_MODS.filter((mod) => set.has(mod));
}

function modRecord(combo: readonly ModKey[]): DiscoverRequest["mods"] {
  const record = { EZ: "off", HD: "off", HR: "off", DT: "off", HT: "off", FL: "off" } as DiscoverRequest["mods"];
  for (const mod of combo) record[mod] = "on";
  return record;
}

function shares<T extends string>(items: { key: T; weight: number }[]): { key: T; share: number }[] {
  const total = items.reduce((sum, item) => sum + item.weight, 0) || 1;
  const map = new Map<T, number>();
  for (const item of items) map.set(item.key, (map.get(item.key) ?? 0) + item.weight);
  return [...map.entries()].map(([key, weight]) => ({ key, share: weight / total })).sort((a, b) => b.share - a.share);
}

// SS pp of a map with given mods, kept so a refresh does not recompute the whole top.
const ssCache = new Map<string, number | null>();

async function ssPp(beatmapId: number, mods: readonly string[]): Promise<number | null> {
  const key = `${beatmapId}:${[...mods].sort().join("")}`;
  if (ssCache.has(key)) return ssCache.get(key)!;
  let value: number | null = null;
  try {
    const result = await calculatePlay({ beatmapId, mode: "osu", mods: [...mods], clockRate: null, accuracy: 100, combo: null, misses: 0 }, "osu", 0, true);
    value = result.score.pp > 0 ? result.score.pp : null;
  } catch {
    value = null;
  }
  if (ssCache.size > 20000) ssCache.clear();
  ssCache.set(key, value);
  return value;
}

/**
 * How much of a map's SS pp the player really gets: their top plays are rarely SS, so a
 * 400 pp play is often a map worth 450 pp at SS. The median over the best plays.
 */
async function scoreRatio(plays: TopPlay[]): Promise<{ ratio: number; ss: number[] }> {
  const ratios: number[] = [];
  const ssList: number[] = [];
  const queue = [...plays];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let play = queue.shift(); play; play = queue.shift()) {
        const ss = await ssPp(play.beatmapId, play.mods.filter((mod) => mod !== "CL"));
        if (ss && ss > 0) {
          ratios.push(Math.min(1, play.pp / ss));
          ssList.push(ss);
        }
      }
    }),
  );
  ssList.sort((a, b) => a - b);
  if (ratios.length < 5) return { ratio: 0.92, ss: ssList };
  ratios.sort((a, b) => a - b);
  return { ratio: Math.max(0.55, Math.min(1, ratios[Math.floor(ratios.length / 2)])), ss: ssList };
}

/** Picks without replacement, favouring high scores, so each refresh shows a new mix. */
function sample<T extends { score: number }>(list: T[], count: number): T[] {
  const pool = [...list].sort((a, b) => b.score - a.score).slice(0, Math.max(count * 3, 30));
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const weights = pool.map((item, index) => Math.max(item.score, 1e-6) / (1 + index * 0.04));
    let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
    let at = 0;
    while (at < pool.length - 1 && roll > weights[at]) roll -= weights[at++];
    out.push(pool.splice(at, 1)[0]);
  }
  return out;
}

const RESULTS = 40;

export async function recommend(sessionId: string | undefined, skip: ReadonlySet<number> = new Set()): Promise<RecommendResponse> {
  const { top, marks } = playerData(sessionId);
  const plays = [...top].sort((a, b) => b.pp - a.pp);
  if (plays.length === 0) return { ppMin: 0, ppMax: 0, ratio: 1, mods: [], styles: [], wanted: [], results: [] };

  // Range: the FC (SS) pp of the maps in the top, from the lowest to the highest, since
  // the player's plays are not all SS. One very low map does not pull the range down.
  const best = plays.slice(0, 50);
  const { ratio, ss } = await scoreRatio(best);
  const ssMin = ss.length >= 5 ? Math.round(ss[Math.floor(ss.length * 0.1)]) : Math.round((plays[Math.min(plays.length - 1, 30)].pp * 0.95) / ratio);
  const ssMax = ss.length >= 5 ? Math.round(ss[ss.length - 1] * 1.03) : Math.round((plays[0].pp * 1.03) / ratio);

  // Mod combos and map types of the best 50 plays, weighted by pp.
  const comboShares = shares(best.map((play) => ({ key: comboOf(play.mods).join("") || "NM", weight: play.pp })));
  const combos = comboShares.filter((item, index) => index === 0 || item.share >= 0.15).slice(0, 3);
  const typed: { key: string; weight: number }[] = [];
  const tagCount = new Map<string, number>();
  let hybridWeight = 0;
  for (const play of best) {
    const profile = getProfile(play.beatmapId);
    if (!profile) continue;
    const scores = styleScores(profile, { version: "" }, modRate(play.mods));
    const main = primaryStyle(scores);
    typed.push({ key: main, weight: play.pp });
    if (main === "hybrid") {
      hybridWeight += play.pp;
      for (const tag of secondaryStyles(scores, main)) tagCount.set(tag, (tagCount.get(tag) ?? 0) + play.pp);
    }
  }
  const styleShares = shares(typed);
  const shareOf = (style: string) => styleShares.find((item) => item.key === style)?.share ?? 0;

  // The top is read like a map: 81 % of stream maps makes a stream player, who gets only
  // stream maps; same for jump. A top with no clear type is a hybrid player: hybrid maps
  // with the leanings their top shows (jump, stream, tech, alt, finger control).
  const dominant = styleShares[0];
  let wanted: ConcreteStyle[];
  if (dominant && dominant.key !== "hybrid" && dominant.share >= 0.55) wanted = [dominant.key as ConcreteStyle];
  else {
    const tags = new Set<ConcreteStyle>();
    if (shareOf("jump") >= 0.25) tags.add("hjump");
    if (shareOf("stream") >= 0.25) tags.add("hstream");
    for (const [tag, weight] of tagCount) if (hybridWeight > 0 && weight / hybridWeight >= 0.3) tags.add(tag as ConcreteStyle);
    wanted = tags.size ? [...tags] : ["hybrid"];
  }

  // The FC range in three slices, each searched on its own and given a third of the list:
  // otherwise the most farmable maps, often in the lower part, fill everything.
  const SLICES = 3;
  const step = (ssMax - ssMin) / SLICES;
  const slices = Array.from({ length: SLICES }, (_, i) => ({ min: Math.round(ssMin + step * i), max: Math.round(ssMin + step * (i + 1)) }));

  const played = new Set(plays.map((play) => play.beatmapId));
  type Pick = RecommendHit & { score: number; slice: number };
  const picked = new Map<number, Pick>();
  for (const combo of combos) {
    const mods = combo.key === "NM" ? [] : (PP_MODS.filter((mod) => combo.key.includes(mod)) as ModKey[]);
    for (const [slice, range] of slices.entries()) {
      let offset = 0;
      for (let page = 0; page < 2; page++) {
        const answer = await discover({
          query: "",
          mode: "osu",
          styles: wanted,
          mods: modRecord(mods),
          ppMin: range.min,
          ppMax: range.max,
          offset,
          sort: [{ key: "farm", dir: "desc" }],
          ranges: emptyRanges(),
        });
        for (const hit of answer.results) consider(hit, combo.share, slice);
        if (!answer.hasMore) break;
        offset = answer.nextOffset;
      }
    }
  }

  function consider(hit: DiscoverHit, comboShare: number, slice: number): void {
    if (played.has(hit.beatmapId) || marks[String(hit.beatmapId)] === "done") return;
    // What the player would really get, at their usual share of the SS pp.
    const gain = ppGain(plays, hit.beatmapId, hit.pp * ratio);
    if (gain <= 0) return;
    const score = gain * (0.5 + hit.farm / 200) * (0.6 + 0.4 * comboShare);
    const previous = picked.get(hit.beatmapId);
    if (!previous || previous.score < score) picked.set(hit.beatmapId, { ...hit, gain, score, slice });
  }

  // Leave out what the last refresh showed, while there is enough else to show.
  let candidates = [...picked.values()];
  const fresh = candidates.filter((hit) => !skip.has(hit.beatmapId));
  if (fresh.length >= RESULTS) candidates = fresh;

  const chosen: Pick[] = [];
  for (let slice = 0; slice < SLICES; slice++) {
    chosen.push(...sample(candidates.filter((hit) => hit.slice === slice), Math.ceil(RESULTS / SLICES)));
  }
  // Fill up with the best of what is left.
  if (chosen.length < RESULTS) {
    const taken = new Set(chosen.map((hit) => hit.beatmapId));
    chosen.push(...sample(candidates.filter((hit) => !taken.has(hit.beatmapId)), RESULTS - chosen.length));
  }

  const results = chosen
    .sort((a, b) => b.pp - a.pp)
    .slice(0, RESULTS)
    .map(({ score: _score, slice: _slice, ...hit }) => hit);
  return {
    ppMin: ssMin,
    ppMax: ssMax,
    ratio,
    mods: combos.map((item) => ({ mods: item.key === "NM" ? [] : item.key.match(/.{2}/g) ?? [], share: item.share })),
    styles: styleShares.map((item) => ({ style: item.key, share: item.share })),
    wanted,
    results,
  };
}
