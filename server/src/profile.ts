import { modRate, primaryStyle, styleScores, type ProfileChoke, type ProfileInsights, type TopPlay } from "@osu-pp/shared";
import { me } from "./account";
import { AppError } from "./errors";
import { rankForPp } from "./osuApi";
import { getProfile } from "./patternStore";
import { calculatePlay } from "./pp";

/**
 * "My profile": the player card (weighted skills, map types, mods) and "if I had FC'd":
 * each top play recomputed as a full combo, misses turned into 300s, the rest unchanged.
 */

interface FcRead {
  pp: number;
  maxCombo: number | null;
  aim: number;
  speed: number;
  accuracy: number;
  reading: number;
  bpm: number | null;
  length: number | null;
}

const fcCache = new Map<string, FcRead | null>();

function fcAccuracy(play: TopPlay): number | null {
  const { n300, n100, n50, misses = 0 } = play;
  if (n300 == null || n100 == null || n50 == null) return play.accuracy;
  const total = n300 + n100 + n50 + misses;
  if (total <= 0) return play.accuracy;
  // osu! accuracy with the misses hit as 300s.
  return Math.min(100, ((300 * (n300 + misses) + 100 * n100 + 50 * n50) / (300 * total)) * 100);
}

async function readFc(play: TopPlay): Promise<FcRead | null> {
  const accuracy = fcAccuracy(play) ?? 100;
  const mods = play.classic ? [...play.mods, "CL"] : play.mods;
  const key = `${play.beatmapId}:${[...mods].sort().join("")}:${accuracy.toFixed(3)}`;
  if (fcCache.has(key)) return fcCache.get(key)!;
  let value: FcRead | null = null;
  try {
    const result = await calculatePlay({ beatmapId: play.beatmapId, mode: "osu", mods, clockRate: null, accuracy, combo: null, misses: 0 }, "osu", 0, true);
    const s = result.score;
    value =
      s.pp > 0
        ? {
            pp: s.pp,
            maxCombo: result.stats.maxCombo ?? null,
            aim: s.aim ?? 0,
            speed: s.speed ?? 0,
            accuracy: s.accuracyPp ?? 0,
            reading: s.reading ?? 0,
            bpm: result.stats.bpm || null,
            length: result.stats.lengthSeconds || null,
          }
        : null;
  } catch {
    value = null;
  }
  if (fcCache.size > 20000) fcCache.clear();
  fcCache.set(key, value);
  return value;
}

async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await work(items[index]);
      }
    }),
  );
  return out;
}

const weighted = (values: number[]) => values.reduce((sum, value, index) => sum + value * 0.95 ** index, 0);
const round = (value: number, step = 1) => Math.round(value / step) * step;

function comboName(mods: readonly string[]): string {
  const set = new Set(mods.map((mod) => (mod === "NC" ? "DT" : mod)));
  return ["EZ", "HD", "HR", "DT", "HT", "FL"].filter((mod) => set.has(mod)).join("") || "NM";
}

function medianOf(values: (number | null)[]): number | null {
  const list = values.filter((value): value is number => value != null && value > 0).sort((a, b) => a - b);
  return list.length ? list[Math.floor(list.length / 2)] : null;
}

const answers = new Map<number, { at: number; topKey: string; value: ProfileInsights }>();
const ANSWER_TTL_MS = 10 * 60 * 1000;

export async function profileInsights(sessionId: string | undefined): Promise<ProfileInsights> {
  const account = await me(sessionId);
  const profile = account.profile;
  if (!account.signedIn || !profile) throw new AppError("signed_out", "Sign in with osu! first.", 401);
  const plays = [...account.top].sort((a, b) => b.pp - a.pp);
  const topKey = plays.map((play) => `${play.beatmapId}:${play.pp}`).join(",");
  const kept = answers.get(profile.id);
  if (kept && kept.topKey === topKey && Date.now() - kept.at < ANSWER_TTL_MS) return kept.value;

  const reads = await mapLimit(plays, 6, readFc);

  // Skills: each part of every play, weighted like pp (best play counts the most).
  const parts = { aim: [] as number[], speed: [] as number[], accuracy: [] as number[], reading: [] as number[] };
  reads.forEach((read) => {
    if (!read) return;
    parts.aim.push(read.aim);
    parts.speed.push(read.speed);
    parts.accuracy.push(read.accuracy);
    parts.reading.push(read.reading);
  });
  const skills = {
    aim: round(weighted(parts.aim.sort((a, b) => b - a))),
    speed: round(weighted(parts.speed.sort((a, b) => b - a))),
    accuracy: round(weighted(parts.accuracy.sort((a, b) => b - a))),
    reading: round(weighted(parts.reading.sort((a, b) => b - a))),
  };

  // If FC: a play counts for its FC pp when that is higher than what it gave.
  const chokes: ProfileChoke[] = [];
  const fcValues = plays.map((play, index) => {
    const read = reads[index];
    if (!read) return play.pp;
    const misses = play.misses ?? 0;
    const broke = read.maxCombo != null && play.combo != null && play.combo < read.maxCombo * 0.97;
    const fc = Math.max(play.pp, read.pp);
    if ((misses > 0 || broke) && fc - play.pp >= 0.5) {
      chokes.push({
        beatmapId: play.beatmapId,
        setId: play.setId ?? null,
        title: play.title ?? `#${play.beatmapId}`,
        artist: play.artist ?? "",
        version: play.version ?? "",
        mods: play.classic ? [...play.mods, "CL"] : play.mods,
        stars: play.stars ?? null,
        accuracy: play.accuracy,
        misses,
        combo: play.combo ?? null,
        maxCombo: read.maxCombo,
        pp: play.pp,
        fcPp: round(fc, 0.01),
      });
      return fc;
    }
    return play.pp;
  });
  const now = weighted(plays.map((play) => play.pp));
  const totalPp = profile.pp ?? now;
  const bonus = Math.max(0, totalPp - now);
  const ifFcPp = round(weighted([...fcValues].sort((a, b) => b - a)) + bonus, 0.01);
  const anchor = profile.pp && profile.rank ? { pp: profile.pp, rank: profile.rank } : undefined;
  let rank: { rank: number; exact: boolean } | null = null;
  try {
    rank = chokes.length ? await rankForPp(ifFcPp, anchor) : profile.rank ? { rank: profile.rank, exact: true } : null;
  } catch {
    rank = null;
  }
  chokes.sort((a, b) => b.fcPp - b.pp - (a.fcPp - a.pp));

  // Map types over the top 20, mods over the whole top.
  const styleCount = new Map<string, number>();
  let styled = 0;
  for (const play of plays.slice(0, 20)) {
    const pattern = getProfile(play.beatmapId);
    if (!pattern) continue;
    const style = primaryStyle(styleScores(pattern, { version: play.version ?? "" }, modRate(play.mods)));
    styleCount.set(style, (styleCount.get(style) ?? 0) + 1);
    styled++;
  }
  const modCount = new Map<string, number>();
  for (const play of plays) modCount.set(comboName(play.mods), (modCount.get(comboName(play.mods)) ?? 0) + 1);
  const accs = plays.map((play) => play.accuracy).filter((acc): acc is number => acc != null);

  const value: ProfileInsights = {
    username: profile.username,
    avatarUrl: profile.avatarUrl,
    country: profile.country,
    pp: totalPp,
    rank: profile.rank,
    countryRank: profile.countryRank ?? null,
    skills,
    styles: [...styleCount].map(([style, count]) => ({ style, share: count / (styled || 1) })).sort((a, b) => b.share - a.share),
    mods: [...modCount].map(([mods, count]) => ({ mods, share: count / (plays.length || 1) })).sort((a, b) => b.share - a.share).slice(0, 5),
    averageAccuracy: accs.length ? round(accs.reduce((sum, acc) => sum + acc, 0) / accs.length, 0.01) : null,
    medianLength: medianOf(reads.slice(0, 20).map((read) => read?.length ?? null)),
    medianBpm: medianOf(reads.slice(0, 20).map((read) => read?.bpm ?? null)),
    topPlay: plays[0] ? { title: plays[0].title ?? `#${plays[0].beatmapId}`, version: plays[0].version ?? "", pp: plays[0].pp, mods: plays[0].mods } : null,
    ifFc: {
      pp: ifFcPp,
      gain: round(Math.max(0, ifFcPp - totalPp), 0.01),
      rank,
      chokes: chokes.slice(0, 30),
      lost: round(chokes.reduce((sum, choke) => sum + choke.fcPp - choke.pp, 0), 0.01),
    },
  };
  answers.set(profile.id, { at: Date.now(), topKey, value });
  return value;
}

/** The player's avatar from our own origin, so the card can be drawn into a PNG. */
export async function avatarBytes(userId: number): Promise<{ type: string; body: Buffer } | null> {
  const response = await fetch(`https://a.ppy.sh/${userId}`, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "image/jpeg";
  if (!type.startsWith("image/")) return null;
  const body = Buffer.from(await response.arrayBuffer());
  return body.length < 2_000_000 ? { type, body } : null;
}
