import { describe, expect, it } from "vitest";
import { parseInput } from "@osu-pp/shared";

describe("parseInput", () => {
  it("reads a difficulty id and never treats it as a set id", () => {
    expect(parseInput("456")).toEqual({ kind: "beatmap", beatmapId: 456 });
    expect(parseInput("  456  ")).toEqual({ kind: "beatmap", beatmapId: 456 });
  });

  it("reads difficulty urls", () => {
    expect(parseInput("https://osu.ppy.sh/b/456")).toEqual({ kind: "beatmap", beatmapId: 456 });
    expect(parseInput("https://osu.ppy.sh/beatmaps/456?mode=osu")).toEqual({
      kind: "beatmap",
      beatmapId: 456,
    });
  });

  it("reads beatmapset urls with a difficulty hash for every mode", () => {
    expect(parseInput("https://osu.ppy.sh/beatmapsets/123#osu/456")).toEqual({
      kind: "beatmap",
      beatmapId: 456,
      beatmapsetId: 123,
      modeHint: "osu",
    });
    expect(parseInput("https://osu.ppy.sh/beatmapsets/123#taiko/789")).toMatchObject({
      beatmapId: 789,
      modeHint: "taiko",
    });
    expect(parseInput("https://osu.ppy.sh/beatmapsets/123#fruits/111")).toMatchObject({
      beatmapId: 111,
      modeHint: "catch",
    });
    expect(parseInput("https://osu.ppy.sh/beatmapsets/123#mania/222")).toMatchObject({
      beatmapId: 222,
      modeHint: "mania",
    });
  });

  it("keeps a bare beatmapset url distinct from a difficulty id", () => {
    expect(parseInput("https://osu.ppy.sh/beatmapsets/123")).toEqual({
      kind: "beatmapset",
      beatmapsetId: 123,
    });
    expect(parseInput("https://osu.ppy.sh/s/123")).toEqual({
      kind: "beatmapset",
      beatmapsetId: 123,
    });
  });

  it("treats a title as a text query", () => {
    expect(parseInput("freedom dive")).toEqual({ kind: "query", query: "freedom dive" });
  });
});
