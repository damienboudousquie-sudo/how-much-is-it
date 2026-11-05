import { PP_COMBOS, classifyStyle, emptyFilters, matchingCombos, modsInCombo, starWindow, styleMatches, textMatches } from "@osu-pp/shared";
import { describe, expect, it } from "vitest";

describe("map styles", () => {
  it("reads the type from tags and the difficulty name", () => {
    expect(classifyStyle({ tags: "aimslop", version: "Expert" })).toBe("jump");
    expect(classifyStyle({ tags: "aim", version: "Expert" })).toBe("jump");
    expect(classifyStyle({ tags: "stream practice", version: "Insane" })).toBe("stream");
    expect(classifyStyle({ tags: "", version: "Speed" })).toBe("speed");
  });

  it("leaves untagged maps unclassified", () => {
    expect(classifyStyle({ tags: "guest mapper", version: "Uri's Extreme" })).toBeNull();
  });

  it("keeps parent categories and exact subtypes", () => {
    expect(styleMatches("jump", "jump")).toBe(true);
    expect(styleMatches("stream", "speed")).toBe(true);
    expect(styleMatches("speed", "stream")).toBe(false);
    expect(styleMatches("any", "tech")).toBe(true);
  });

  it("parses every precomputed combo and filters required, either, and off", () => {
    for (const combo of PP_COMBOS) modsInCombo(combo);
    expect(matchingCombos(emptyFilters())).toEqual(["NM"]);
    const eitherHr = emptyFilters();
    eitherHr.HR = "any";
    expect(matchingCombos(eitherHr)).toEqual(["NM", "HR"]);
    const requiredHr = emptyFilters();
    requiredHr.HR = "on";
    expect(matchingCombos(requiredHr)).toEqual(["HR"]);
  });

  it("matches every word of a title query", () => {
    expect(textMatches("dragon flame", ["Power of the Dragonflame", "Rhapsody"])).toBe(true);
    expect(textMatches("dragon flame", ["Freedom Dive"])).toBe(false);
    expect(textMatches("  ", ["anything"])).toBe(true);
  });

  it("places a 550 pp nomod map near 7 stars", () => {
    const [low, high] = starWindow(520, 580, [], null);
    expect(low).toBeLessThan(7);
    expect(high).toBeGreaterThan(7);
  });
});
