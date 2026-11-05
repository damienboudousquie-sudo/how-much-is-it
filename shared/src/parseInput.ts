import type { Mode } from "./types";

export type ParsedInput =
  | { kind: "beatmap"; beatmapId: number; beatmapsetId?: number; modeHint?: Mode }
  | { kind: "beatmapset"; beatmapsetId: number }
  | { kind: "query"; query: string };

const MODE_HINT: Record<string, Mode> = {
  osu: "osu",
  taiko: "taiko",
  fruits: "catch",
  mania: "mania",
};

export function validId(id: number): boolean {
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647;
}

export function parseInput(raw: string): ParsedInput {
  const text = raw.trim();
  if (!text) return { kind: "query", query: "" };

  if (/^\d{1,10}$/.test(text)) {
    const id = Number(text);
    if (validId(id)) return { kind: "beatmap", beatmapId: id };
    return { kind: "query", query: text.slice(0, 100) };
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "query", query: text.slice(0, 100) };
  }

  const host = url.hostname.toLowerCase();
  if (host !== "osu.ppy.sh" && !host.endsWith(".ppy.sh")) {
    return { kind: "query", query: text.slice(0, 100) };
  }

  const beatmapPath = url.pathname.match(/^\/(?:beatmaps|b)\/(\d+)\/?$/);
  if (beatmapPath) {
    const beatmapId = Number(beatmapPath[1]);
    if (!validId(beatmapId)) return { kind: "query", query: text.slice(0, 100) };
    return { kind: "beatmap", beatmapId };
  }

  const setPath = url.pathname.match(/^\/(?:beatmapsets|s)\/(\d+)/);
  if (!setPath) return { kind: "query", query: text.slice(0, 100) };

  const beatmapsetId = Number(setPath[1]);
  if (!validId(beatmapsetId)) return { kind: "query", query: text.slice(0, 100) };

  const hash = url.hash.replace(/^#/, "");
  const hashed = hash.match(/^(osu|taiko|fruits|mania)\/(\d+)$/);
  if (hashed) {
    const beatmapId = Number(hashed[2]);
    if (!validId(beatmapId)) return { kind: "beatmapset", beatmapsetId };
    return {
      kind: "beatmap",
      beatmapId,
      beatmapsetId,
      modeHint: MODE_HINT[hashed[1]],
    };
  }

  const hashId = hash.match(/^(\d+)$/);
  if (hashId) {
    const beatmapId = Number(hashId[1]);
    if (validId(beatmapId)) return { kind: "beatmap", beatmapId, beatmapsetId };
  }

  return { kind: "beatmapset", beatmapsetId };
}
