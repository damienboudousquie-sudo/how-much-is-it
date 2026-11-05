import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Beatmap, Difficulty } from "rosu-pp-js";
import { primeBeatmap } from "../src/beatmapCache";
import { AppError } from "../src/errors";
import { calculateFixture, calculatePlay } from "../src/pp";

const bytes = new Uint8Array(readFileSync(new URL("./fixtures/tiny.osu", import.meta.url)));
const base = { mods: [] as string[], clockRate: null, accuracy: 100, combo: null, misses: 0 };

describe("pp", () => {
  it("matches a frozen full-combo value within 0.01 pp", () => {
    const result = calculateFixture(bytes, base);
    expect(result.score.pp).toBeCloseTo(20.24082184850346, 2);
    expect(result.stats.stars).toBeGreaterThan(0);
    expect(result.curve.map((point) => point.accuracy)).toEqual([100, 99, 98, 97, 95]);
    expect(result.curve[0]!.pp).toBeGreaterThanOrEqual(result.curve[4]!.pp);
  });

  it("clamps an impossible combo and refuses too many misses", () => {
    const clamped = calculateFixture(bytes, { ...base, combo: 500 });
    expect(clamped.score.combo).toBe(clamped.stats.maxCombo);
    expect(clamped.warnings[0]).toMatch(/capped at 6/);
    expect(() => calculateFixture(bytes, { ...base, misses: 50 })).toThrow(AppError);
  });

  it("calculates osu, taiko, catch and mania", () => {
    for (const mode of ["osu", "taiko", "catch", "mania"] as const) {
      const result = calculateFixture(bytes, { ...base, mode });
      expect(result.mode).toBe(mode);
      expect(Number.isFinite(result.score.pp)).toBe(true);
      expect(result.score.pp).toBeGreaterThan(0);
    }
  });

  it("reuses a cached difficulty for a second score", async () => {
    primeBeatmap(1, bytes);
    const first = await calculatePlay({ beatmapId: 1, ...base }, "osu", 2500);
    const second = await calculatePlay(
      { beatmapId: 1, ...base, accuracy: 98, misses: 1, combo: 3 },
      "osu",
      2500,
    );
    expect(second.score.pp).toBeGreaterThan(0);
    expect(second.score.pp).toBeLessThan(first.score.pp);
    expect(second.stats.stars).toBeCloseTo(first.stats.stars, 2);
  });

  it("does not apply DT speed twice when clockRate is also 1.5", () => {
    const map = new Beatmap(bytes);
    try {
      expect(map.isSuspicious()).toBe(false);
      const plain = new Difficulty({ mods: [{ acronym: "DT" }], lazer: true });
      const doubled = new Difficulty({ mods: [{ acronym: "DT" }], clockRate: 1.5, lazer: true });
      const custom = new Difficulty({ mods: [{ acronym: "DT" }], clockRate: 1.25, lazer: true });
      const plainAttrs = plain.calculate(map);
      const doubledAttrs = doubled.calculate(map);
      const customAttrs = custom.calculate(map);
      expect(doubledAttrs.stars).toBeCloseTo(plainAttrs.stars, 2);
      expect(customAttrs.stars).toBeLessThan(plainAttrs.stars);
      plainAttrs.free();
      doubledAttrs.free();
      customAttrs.free();
      plain.free();
      doubled.free();
      custom.free();
    } finally {
      map.free();
    }
  });
});
