import type { Mode } from "@osu-pp/shared";

export type AppRoute = { page: "maps"; mode: Mode } | { page: "beatmap"; mode: Mode; id: number };

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

export function mapsPath(mode: Mode): string {
  return `#/${mode}/maps`;
}

export function beatmapPath(mode: Mode, id: number): string {
  return `#/${mode}/b/${id}`;
}
