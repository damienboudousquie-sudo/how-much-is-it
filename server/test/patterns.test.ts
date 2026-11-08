import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { farmHint, farmScores, guessedScores, lengthScore, matchesAnyStyle, matchesStyleScores, primaryStyle, secondaryStyle, styleScores } from "@osu-pp/shared";
import { analyzePatterns } from "../src/patterns";

/** Builds a minimal osu! standard map from [x, y, time] circles at one BPM. */
function osuFile(bpm: number, circles: [number, number, number][], extra = ""): string {
  const beat = 60_000 / bpm;
  return [
    "osu file format v14",
    "[General]",
    "Mode: 0",
    "[Difficulty]",
    "CircleSize:4",
    "SliderMultiplier:1.4",
    "[TimingPoints]",
    `0,${beat},4,2,0,100,1,0`,
    "[HitObjects]",
    ...circles.map(([x, y, time]) => `${x},${y},${Math.round(time)},1,0,0:0:0:0:`),
    extra,
  ].join("\n");
}

function streams(bpm: number, count: number): [number, number, number][] {
  const quarter = 60_000 / bpm / 4;
  return Array.from({ length: count }, (_, index) => [200 + (index % 16) * 12, 200, 1000 + index * quarter]);
}

function jumps(bpm: number, count: number): [number, number, number][] {
  const half = 60_000 / bpm / 2;
  return Array.from({ length: count }, (_, index) => [index % 2 === 0 ? 60 : 450, index % 4 < 2 ? 80 : 300, 1000 + index * half]);
}

describe("pattern analysis", () => {
  it("reads a full 1/4 map as a stream map", () => {
    const profile = analyzePatterns(osuFile(180, streams(180, 400)))!;
    expect(profile.streamShare).toBeGreaterThan(0.9);
    expect(profile.longestStream).toBe(400);
    const scores = styleScores(profile);
    expect(primaryStyle(scores)).toBe("stream");
    expect(matchesStyleScores(scores, "jump")).toBe(false);
  });

  it("reads spaced 1/2 as jumps even when notes per beat look like a stream", () => {
    const profile = analyzePatterns(osuFile(200, jumps(200, 400)))!;
    expect(profile.jumpShare).toBeGreaterThan(0.9);
    expect(profile.streamShare).toBe(0);
    expect(primaryStyle(styleScores(profile))).toBe("jump");
  });

  it("keeps fast 1/2 jumps as jumps, not speed (DT aim maps)", () => {
    const scores = styleScores(analyzePatterns(osuFile(260, jumps(260, 400)))!);
    expect(primaryStyle(scores)).toBe("jump");
    expect(matchesStyleScores(scores, "speed")).toBe(false);
  });

  it("tags fast streams speed, and counts DT in the speed", () => {
    const fastStreams = styleScores(analyzePatterns(osuFile(250, streams(250, 400)))!);
    expect(primaryStyle(fastStreams)).toBe("stream");
    expect(secondaryStyle(fastStreams)).toBe("speed");
    expect(matchesStyleScores(fastStreams, "speed")).toBe(true);
    expect(matchesStyleScores(fastStreams, "stream")).toBe(true);
    const plain = analyzePatterns(osuFile(170, streams(170, 400)))!;
    expect(secondaryStyle(styleScores(plain))).toBe(null);
    expect(secondaryStyle(styleScores(plain, undefined, 1.5))).toBe("speed");
  });

  it("puts jumps mixed with bursts in hybrid, and narrows with a secondary tag", () => {
    const profile = {
      v: 3, objects: 900, bpm: 190, streamShare: 0.07, burstShare: 0.26, doubleShare: 0.02, longestStream: 9,
      streamSpacing: 1.2, jumpShare: 0.4, jumpSpacing: 5, speedShare: 0, sliderShare: 0.22, irregularShare: 0.01,
      rhythmEntropy: 1.7, svChanges: 3, drain: 150,
    };
    const scores = styleScores(profile);
    expect(primaryStyle(scores)).toBe("hybrid");
    expect(matchesAnyStyle(scores, ["jump"])).toBe(false);
    expect(matchesAnyStyle(scores, ["hybrid"])).toBe(true);
    expect(matchesAnyStyle(scores, ["hybrid", "tech"])).toBe(matchesStyleScores(scores, "tech"));
  });

  it("treats 1/8 streams at half BPM as 1/4 streams", () => {
    const quarter = 60_000 / 100 / 8;
    const circles: [number, number, number][] = Array.from({ length: 300 }, (_, index) => [200 + (index % 10) * 10, 200, 1000 + index * quarter]);
    const profile = analyzePatterns(osuFile(100, circles))!;
    expect(profile.bpm).toBe(200);
    expect(profile.irregularShare).toBeLessThan(0.05);
    // 200 BPM streams once rescaled: plain streams, speed starts around 240.
    expect(primaryStyle(styleScores(profile))).toBe("stream");
  });

  it("skips non-standard maps", () => {
    expect(analyzePatterns(osuFile(180, streams(180, 100)).replace("Mode: 0", "Mode: 3"))).toBeNull();
  });

  it("does not crash on the tiny fixture", () => {
    const text = readFileSync(new URL("./fixtures/tiny.osu", import.meta.url), "utf8");
    expect(() => analyzePatterns(text)).not.toThrow();
  });
});

describe("farm", () => {
  it("spots TV sizes and farm mappers", () => {
    expect(farmHint({ title: "Harumachi Clover (TV Size)", creator: "Sotarks", tags: "" })).toBe(1);
    expect(farmHint({ title: "Freedom Dive", creator: "Nakagawa-Kanon", tags: "" })).toBe(0);
  });

  it("prefers short drain", () => {
    expect(lengthScore(90)).toBe(1);
    expect(lengthScore(400)).toBeLessThan(lengthScore(180));
  });

  it("does not hold back short DT cuts", () => {
    expect(lengthScore(30)).toBe(1);
    expect(lengthScore(5)).toBeLessThan(lengthScore(15));
  });

  it("allows much longer stream maps than jump maps", () => {
    expect(lengthScore(339, ["stream"])).toBeGreaterThan(0.9);
    expect(lengthScore(339)).toBeLessThan(0.5);
    expect(lengthScore(339, ["jump", "stream"])).toBe(lengthScore(339, ["stream"]));
  });

  it("ranks a short low-star jump map above a long stream map worth the same pp", () => {
    const jump = { pp: 400, stars: 6.2, lengthSeconds: 85, hint: 0.5, scores: { ...guessedScores(null), jump: 1, stream: 0 } };
    const stream = { pp: 400, stars: 6.8, lengthSeconds: 280, hint: 0, scores: { ...guessedScores(null), jump: 0.1, stream: 1 } };
    const [jumpScore, streamScore] = farmScores([jump, stream], []);
    expect(jumpScore).toBeGreaterThan(streamScore!);
  });
});
