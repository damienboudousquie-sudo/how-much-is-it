import type { Mode } from "@osu-pp/shared";

export type AppRoute = { page: "maps"; mode: Mode } | { page: "beatmap"; mode: Mode; id: number } | { page: "pinned" } | { page: "feedback" } | { page: "foryou" } | { page: "stats" } | { page: "legal" } | { page: "profile" } | { page: "changelog" };

const MODES = new Set<Mode>(["osu", "taiko", "catch", "mania"]);

function isMode(value: string): value is Mode {
  return MODES.has(value as Mode);
}

function beatmapId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

export function parseRoute(hash: string, search = ""): AppRoute {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "pinned") return { page: "pinned" };
  if (parts[0] === "feedback") return { page: "feedback" };
  if (parts[0] === "foryou") return { page: "foryou" };
  if (parts[0] === "stats") return { page: "stats" };
  if (parts[0] === "legal") return { page: "legal" };
  if (parts[0] === "profile") return { page: "profile" };
  if (parts[0] === "changelog") return { page: "changelog" };
  if (parts[0] && isMode(parts[0]) && parts[1] === "maps") return { page: "maps", mode: parts[0] };
  if (parts[0] && isMode(parts[0]) && parts[1] === "b") {
    const id = beatmapId(parts[2]);
    if (id != null) return { page: "beatmap", mode: parts[0], id };
  }
  if (parts[0] === "b") {
    const id = beatmapId(parts[1]);
    if (id != null) return { page: "beatmap", mode: "osu", id };
  }
  const fromQuery = beatmapId(new URLSearchParams(search).get("b") ?? undefined);
  if (fromQuery != null) return { page: "beatmap", mode: "osu", id: fromQuery };
  return { page: "maps", mode: "osu" };
}

export const PINNED_PATH = "#/pinned";
export const FEEDBACK_PATH = "#/feedback";
export const FOR_YOU_PATH = "#/foryou";
export const STATS_PATH = "#/stats";
export const LEGAL_PATH = "#/legal";
export const PROFILE_PATH = "#/profile";
export const CHANGELOG_PATH = "#/changelog";

export function mapsPath(mode: Mode): string {
  return `#/${mode}/maps`;
}

export function beatmapPath(mode: Mode, id: number): string {
  return `#/${mode}/b/${id}`;
}
