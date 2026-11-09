import {
  emptyRanges,
  modRate,
  ppGain,
  primaryStyle,
  styleScores,
  type DiscoverHit,
  type DiscoverRequest,
  type RecommendHit,
  type RecommendResponse,
  type TopPlay,
} from "@osu-pp/shared";
import { playerData } from "./account";
import { getProfile } from "./patternStore";
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

export async function recommend(sessionId: string | undefined): Promise<RecommendResponse> {
  const { top, marks } = playerData(sessionId);
  const plays = [...top].sort((a, b) => b.pp - a.pp);
  if (plays.length === 0) return { ppMin: 0, ppMax: 0, mods: [], styles: [], results: [] };

  // Range: from around the 30th play (worth entering the top) to a little above the best.
  const ppMin = Math.max(0, Math.round(plays[Math.min(plays.length - 1, 30)].pp * 0.95));
  const ppMax = Math.round(plays[0].pp * 1.03);

  // Mod combos and map types of the best 50 plays, weighted by pp.
  const best = plays.slice(0, 50);
  const comboShares = shares(best.map((play) => ({ key: comboOf(play.mods).join("") || "NM", weight: play.pp })));
  const combos = comboShares.filter((item, index) => index === 0 || item.share >= 0.15).slice(0, 3);
  const typed: { key: string; weight: number }[] = [];
  for (const play of best) {
    const profile = getProfile(play.beatmapId);
    if (!profile) continue;
    typed.push({ key: primaryStyle(styleScores(profile, { version: "" }, modRate(play.mods))), weight: play.pp });
  }
  const styleShares = shares(typed);
  const styleShare = (style: string | null) => styleShares.find((item) => item.key === style)?.share ?? 0;

  const played = new Set(plays.map((play) => play.beatmapId));
  const picked = new Map<number, RecommendHit & { score: number }>();
  for (const combo of combos) {
    const mods = combo.key === "NM" ? [] : (PP_MODS.filter((mod) => combo.key.includes(mod)) as ModKey[]);
    let offset = 0;
    for (let page = 0; page < 3; page++) {
      const answer = await discover({
        query: "",
        mode: "osu",
        styles: [],
        mods: modRecord(mods),
        ppMin,
        ppMax,
        offset,
        sort: [{ key: "farm", dir: "desc" }],
        ranges: emptyRanges(),
      });
      for (const hit of answer.results) consider(hit, combo.share);
      if (!answer.hasMore) break;
      offset = answer.nextOffset;
    }
  }

  function consider(hit: DiscoverHit, comboShare: number): void {
    if (played.has(hit.beatmapId) || marks[String(hit.beatmapId)] === "done") return;
    // A realistic score, not an SS: about 98 % accuracy.
    const gain = ppGain(plays as TopPlay[], hit.beatmapId, hit.pp * 0.94);
    if (gain <= 0) return;
    const styleFit = styleShares.length ? Math.max(0.12, styleShare(hit.style)) : 0.5;
    const score = gain * (0.5 + hit.farm / 200) * (0.35 + 0.65 * styleFit) * (0.6 + 0.4 * comboShare);
    const previous = picked.get(hit.beatmapId);
    if (!previous || previous.score < score) picked.set(hit.beatmapId, { ...hit, gain, score });
  }

  const results = [...picked.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map(({ score: _score, ...hit }) => hit);
  return {
    ppMin,
    ppMax,
    mods: combos.map((item) => ({ mods: item.key === "NM" ? [] : item.key.match(/.{2}/g) ?? [], share: item.share })),
    styles: styleShares.map((item) => ({ style: item.key, share: item.share })),
    results,
  };
}
