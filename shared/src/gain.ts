import type { TopPlay } from "./types";

/**
 * Weighted pp of a top list, as osu! counts it: the best play counts fully, each next
 * one 5 % less (x0.95^i). The bonus pp from the number of ranked plays is left out.
 */
function weighted(pps: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < pps.length; index += 1) total += pps[index]! * 0.95 ** index;
  return total;
}

/**
 * How much the player's total would grow with a new play worth `pp` on `beatmapId`.
 * A map already in the top only counts if the new play beats the old one. 0 when the
 * play would not enter the top 100 or would not beat the existing score.
 */
export function ppGain(top: readonly TopPlay[], beatmapId: number, pp: number): number {
  if (top.length === 0 || !(pp > 0)) return 0;
  const existing = top.find((play) => play.beatmapId === beatmapId);
  if (existing && existing.pp >= pp) return 0;
  const before = top.map((play) => play.pp).sort((a, b) => b - a);
  const others = top.filter((play) => play !== existing).map((play) => play.pp);
  const after = [...others, pp].sort((a, b) => b - a).slice(0, 100);
  return Math.max(0, Math.round((weighted(after) - weighted(before.slice(0, 100))) * 10) / 10);
}
