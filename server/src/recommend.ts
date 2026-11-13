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
  type Mode,
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

// SS pp of a map with given mods (and its length and BPM with those mods), kept so a
// refresh does not recompute the whole top.
interface SsInfo {
  pp: number;
  bpm: number;
  length: number;
}
const ssCache = new Map<string, SsInfo | null>();

async function ssInfo(beatmapId: number, mods: readonly string[], mode: Mode = "osu"): Promise<SsInfo | null> {
  const key = `${mode}:${beatmapId}:${[...mods].sort().join("")}`;
  if (ssCache.has(key)) return ssCache.get(key)!;
  let value: SsInfo | null = null;
  try {
    const result = await calculatePlay({ beatmapId, mode, mods: [...mods], clockRate: null, accuracy: 100, combo: null, misses: 0 }, mode, 0, true);
    value = result.score.pp > 0 ? { pp: result.score.pp, bpm: result.stats.bpm, length: result.stats.lengthSeconds } : null;
  } catch {
    value = null;
  }
  if (ssCache.size > 20000) ssCache.clear();
  ssCache.set(key, value);
  return value;
}

async function ssPp(beatmapId: number, mods: readonly string[], mode: Mode = "osu"): Promise<number | null> {
  return (await ssInfo(beatmapId, mods, mode))?.pp ?? null;
}

/** pp of a full combo at the given accuracy (no miss), cached like ssPp. */
const fcCache = new Map<string, number | null>();

async function fcPp(beatmapId: number, mods: readonly string[], accuracy: number, mode: Mode = "osu"): Promise<number | null> {
  const key = `${mode}:${beatmapId}:${[...mods].sort().join("")}:${accuracy.toFixed(2)}`;
  if (fcCache.has(key)) return fcCache.get(key)!;
  let value: number | null = null;
  try {
    const result = await calculatePlay({ beatmapId, mode, mods: [...mods], clockRate: null, accuracy, combo: null, misses: 0 }, mode, 0, true);
    value = result.score.pp > 0 ? result.score.pp : null;
  } catch {
    value = null;
  }
  if (fcCache.size > 20000) fcCache.clear();
  fcCache.set(key, value);
  return value;
}

function median(values: number[], fallback: number): number {
  if (values.length < 3) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * How much of a map's SS pp the player really gets (their top plays are rarely SS), and
 * the SS level each top play stands for.
 *
 * A choked play (misses) on a hard map does not mean the player can FC maps that hard: its
 * level is the SS pp they would need, at their usual accuracy, to score what they really
 * scored (play pp ÷ accuracy share), capped by the map's SS pp. So a 230 pp play with 4
 * misses on a map worth 420 at SS counts as ~280, not 420.
 */
async function scoreRatio(plays: TopPlay[], mode: Mode): Promise<{ ratio: number; levels: number[] }> {
  const ratios: number[] = [];
  const accShares: number[] = [];
  const found: { play: TopPlay; ss: number }[] = [];
  const queue = [...plays];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let play = queue.shift(); play; play = queue.shift()) {
        const mods = play.mods.filter((mod) => mod !== "CL");
        const ss = await ssPp(play.beatmapId, mods, mode);
        if (!ss || ss <= 0) continue;
        ratios.push(Math.min(1, play.pp / ss));
        found.push({ play, ss });
        if (play.accuracy != null && play.accuracy < 100) {
          const fc = await fcPp(play.beatmapId, mods, play.accuracy, mode);
          if (fc) accShares.push(Math.min(1, fc / ss));
        } else if (play.accuracy === 100) {
          accShares.push(1);
        }
      }
    }),
  );
  const accShare = Math.max(0.6, Math.min(1, median(accShares, 0.92)));
  const levels = found.map(({ play, ss }) => Math.min(ss, play.pp / accShare)).sort((a, b) => a - b);
  const ratio = ratios.length < 3 ? 0.92 : Math.max(0.55, Math.min(1, median(ratios, 0.92)));
  return { ratio, levels };
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

export async function recommend(sessionId: string | undefined, skip: ReadonlySet<number> = new Set(), askedMode?: Mode): Promise<RecommendResponse> {
  const { top, marks, mode, profile: player } = await playerData(sessionId, askedMode);
  const plays = [...top].sort((a, b) => b.pp - a.pp);
  // Map types (jump, stream, hybrid) exist for osu! (standard) only: the other modes get
  // one group, matched on pp range, mods and length.
  const standard = mode === "osu";
  if (plays.length === 0) return { profile: player, ppMin: 0, ppMax: 0, ratio: 1, mods: [], styles: [], wanted: [], results: [] };

  // Everything is read from the top 20: the SS level of those plays sets the range, from
  // the lowest to 10 % above the highest. A choke on a much harder map counts for what the
  // player really scored there, not for the map's SS pp (see scoreRatio).
  const best = plays.slice(0, 20);
  const { ratio, levels } = await scoreRatio(best, mode);
  const ssMin = levels.length >= 3 ? Math.round(levels[0]) : Math.round((plays[Math.min(plays.length - 1, 19)].pp * 0.95) / ratio);
  // Top: 10 % above the best level, to leave room to progress.
  const ssMax = levels.length >= 3 ? Math.round(levels[levels.length - 1] * 1.1) : Math.round((plays[0].pp * 1.1) / ratio);

  // Each top-20 play is read like a map: jump, stream or hybrid (with its leanings), with
  // its mods, length and BPM. The list then mirrors the top: a player with half streams
  // and half jumps gets half stream maps and half jump maps, each group with the mods that
  // group is played with, and maps close in length (and BPM, for streams) come first.
  type Group = "jump" | "stream" | "hybrid";
  interface Read {
    group: Group;
    combo: string;
    tags: ConcreteStyle[];
    length: number | null;
    bpm: number | null;
  }
  const reads: Read[] = [];
  await Promise.all(
    best.map(async (play) => {
      const profile = standard ? getProfile(play.beatmapId) : null;
      if (standard && !profile) return;
      const scores = profile ? styleScores(profile, { version: "" }, modRate(play.mods)) : null;
      const main = scores ? (primaryStyle(scores) as Group) : "hybrid";
      const info = await ssInfo(play.beatmapId, play.mods.filter((mod) => mod !== "CL"), mode);
      reads.push({
        group: main,
        combo: comboOf(play.mods).join("") || "NM",
        tags: scores && main === "hybrid" ? secondaryStyles(scores, main) : [],
        length: info?.length ?? null,
        bpm: info?.bpm ?? null,
      });
    }),
  );
  const comboShares = shares(best.map((play) => ({ key: comboOf(play.mods).join("") || "NM", weight: 1 })));
  const styleShares = standard ? shares(reads.map((read) => ({ key: read.group as string, weight: 1 }))) : [];

  const groups: Group[] = (["stream", "jump", "hybrid"] as Group[]).filter((group) => reads.some((read) => read.group === group));
  if (groups.length === 0) groups.push("hybrid");
  const quota = new Map<Group, number>();
  {
    const total = reads.length || 1;
    let left = RESULTS;
    const raw = groups.map((group) => ({ group, exact: (RESULTS * (reads.filter((read) => read.group === group).length || (reads.length ? 0 : 1))) / total }));
    for (const item of raw) {
      const count = Math.floor(item.exact);
      quota.set(item.group, count);
      left -= count;
    }
    // Largest remainders get the last places.
    for (const item of [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1))) {
      if (left <= 0) break;
      quota.set(item.group, (quota.get(item.group) ?? 0) + 1);
      left--;
    }
  }

  const median = (values: (number | null)[]) => {
    const list = values.filter((value): value is number => value != null && value > 0).sort((a, b) => a - b);
    return list.length ? list[Math.floor(list.length / 2)] : null;
  };
  const plan = groups.map((group) => {
    const mine = reads.filter((read) => read.group === group);
    const source = mine.length ? mine : reads;
    const groupCombos = shares(source.map((read) => ({ key: read.combo, weight: 1 })));
    const combos = (groupCombos.length ? groupCombos : comboShares).filter((item, index) => index === 0 || item.share >= 0.15).slice(0, 3);
    let styles: ConcreteStyle[];
    if (!standard) styles = [];
    else if (group !== "hybrid") styles = [group];
    else {
      const tagCount = new Map<ConcreteStyle, number>();
      for (const read of mine) for (const tag of read.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      styles = [...tagCount].filter(([, count]) => mine.length && count / mine.length >= 0.3).map(([tag]) => tag);
      if (styles.length === 0) styles = ["hybrid"];
    }
    return {
      group,
      combos,
      styles,
      length: median(mine.map((read) => read.length)),
      bpm: group === "stream" && standard ? median(mine.map((read) => read.bpm)) : null,
    };
  });
  const wanted = [...new Set(plan.flatMap((item) => item.styles))];

  /** 1 for the same length (and BPM for streams), lower the further away. */
  function similarity(hit: DiscoverHit, target: (typeof plan)[number]): number {
    let value = 1;
    if (target.length && hit.lengthSeconds) value *= Math.exp(-Math.abs(Math.log(hit.lengthSeconds / target.length)) / 0.35);
    if (target.bpm && hit.bpm) value *= Math.exp(-Math.abs(hit.bpm - target.bpm) / 18);
    return value;
  }

  // The FC range in three slices, each searched on its own and given a third of each group:
  // otherwise the most farmable maps, often in the lower part, fill everything.
  const SLICES = 3;
  const step = (ssMax - ssMin) / SLICES;
  const slices = Array.from({ length: SLICES }, (_, i) => ({ min: Math.round(ssMin + step * i), max: Math.round(ssMin + step * (i + 1)) }));

  const played = new Set(plays.map((play) => play.beatmapId));
  type Pick = RecommendHit & { score: number; slice: number; group: Group; sim: number };
  const picked = new Map<number, Pick>();
  for (const target of plan) {
    for (const combo of target.combos) {
      const mods = combo.key === "NM" ? [] : (PP_MODS.filter((mod) => combo.key.includes(mod)) as ModKey[]);
      for (const [slice, range] of slices.entries()) {
        let offset = 0;
        for (let page = 0; page < 2; page++) {
          const answer = await discover({
            query: "",
            mode,
            styles: target.styles,
            mods: modRecord(mods),
            ppMin: range.min,
            ppMax: range.max,
            offset,
            sort: [{ key: "farm", dir: "desc" }],
            ranges: emptyRanges(),
          });
          for (const hit of answer.results) consider(hit, combo.share, slice, target);
          if (!answer.hasMore) break;
          offset = answer.nextOffset;
        }
      }
    }
  }

  function consider(hit: DiscoverHit, comboShare: number, slice: number, target: (typeof plan)[number]): void {
    if (played.has(hit.beatmapId) || marks[String(hit.beatmapId)] === "done" || hit.pp < ssMin) return;
    // What the player would really get, at their usual share of the SS pp.
    const gain = ppGain(plays, hit.beatmapId, hit.pp * ratio);
    if (gain <= 0) return;
    const sim = similarity(hit, target);
    const score = gain * (0.5 + hit.farm / 200) * (0.6 + 0.4 * comboShare) * (0.2 + 0.8 * sim);
    const previous = picked.get(hit.beatmapId);
    if (!previous || previous.score < score) picked.set(hit.beatmapId, { ...hit, gain, score, slice, group: target.group, sim });
  }

  // Leave out what the last refresh showed, while there is enough else to show.
  let candidates = [...picked.values()];
  const fresh = candidates.filter((hit) => !skip.has(hit.beatmapId));
  if (fresh.length >= RESULTS) candidates = fresh;

  // Each group gets its share of the list, spread over the three slices.
  function draw(group: Group, count: number, taken: Set<number>): Pick[] {
    const pool = candidates.filter((hit) => hit.group === group && !taken.has(hit.beatmapId));
    const out: Pick[] = [];
    for (let slice = 0; slice < SLICES && out.length < count; slice++) {
      const want = Math.ceil((count - out.length) / (SLICES - slice));
      out.push(...sample(pool.filter((hit) => hit.slice === slice && !out.includes(hit)), want));
    }
    if (out.length < count) out.push(...sample(pool.filter((hit) => !out.includes(hit)), count - out.length));
    for (const hit of out) taken.add(hit.beatmapId);
    return out;
  }
  const taken = new Set<number>();
  const chosen: Pick[] = [];
  for (const group of groups) chosen.push(...draw(group, quota.get(group) ?? 0, taken));
  // A group short of maps: fill up with the others.
  if (chosen.length < RESULTS) chosen.push(...sample(candidates.filter((hit) => !taken.has(hit.beatmapId)), RESULTS - chosen.length));
  for (const hit of chosen) taken.add(hit.beatmapId);

  // The lists' pp come from a mirror that may lag behind the pp rework: show the same pp as
  // the map page (our calculator), with the gain that goes with it, and drop what our pp put
  // outside the range (replaced from the same group while time remains).
  const deadline = Date.now() + 8000;
  const exact = new Set<number>();
  async function recompute(list: Pick[]): Promise<void> {
    const queue = [...list];
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let hit = queue.shift(); hit; hit = queue.shift()) {
          if (Date.now() > deadline) break;
          const ss = await ssPp(hit.beatmapId, hit.mods, mode);
          if (!ss) continue;
          hit.pp = Math.round(ss * 100) / 100;
          hit.gain = ppGain(plays, hit.beatmapId, ss * ratio);
          exact.add(hit.beatmapId);
        }
      }),
    );
  }
  const inRange = (hit: Pick) => !exact.has(hit.beatmapId) || (hit.pp >= ssMin && hit.pp <= ssMax && hit.gain > 0);
  await recompute(chosen);
  let kept = chosen.filter(inRange);
  for (let round = 0; round < 3 && kept.length < RESULTS && Date.now() < deadline; round++) {
    const more: Pick[] = [];
    for (const group of groups) {
      const missing = (quota.get(group) ?? 0) - kept.filter((hit) => hit.group === group).length;
      if (missing > 0) more.push(...draw(group, missing, taken));
    }
    if (more.length === 0) break;
    await recompute(more);
    kept = [...kept, ...more.filter(inRange)];
  }
  chosen.length = 0;
  chosen.push(...kept);

  // Closest to what the player usually plays (length, and BPM for streams) first.
  const results = chosen
    .sort((a, b) => b.sim - a.sim || b.pp - a.pp)
    .slice(0, RESULTS)
    .map(({ score: _score, slice: _slice, group: _group, sim: _sim, ...hit }) => hit);
  return {
    profile: player,
    ppMin: ssMin,
    ppMax: ssMax,
    ratio,
    mods: comboShares.slice(0, 4).map((item) => ({ mods: item.key === "NM" ? [] : item.key.match(/.{2}/g) ?? [], share: item.share })),
    styles: styleShares.map((item) => ({ style: item.key, share: item.share })),
    wanted,
    results,
  };
}
