import { PP_COMBOS, classifyStyle, compareDiscover, emptyFilters, inRange, legacySort, matchingCombos, modsInCombo, styleMatches, textMatches } from "@osu-pp/shared";
import { describe, expect, it } from "vitest";

describe("map styles", () => {
  it("keeps a type only when that pattern is most of the map", () => {
    expect(classifyStyle({ tags: "aimslop jump", version: "Expert" })).toBeNull();
    expect(classifyStyle({ tags: "", version: "Jump Training" })).toBe("jump");
    expect(classifyStyle({ tags: "", version: "Deathstream" })).toBe("stream");
    expect(classifyStyle({ tags: "", version: "Speed" })).toBe("speed");
    expect(classifyStyle({ tags: "alt rock", version: "Insane" })).toBeNull();
    expect(classifyStyle({ tags: "", version: "Four Dimensions", bpm: 222, density: 8.81, circleRatio: 0.83 })).toBe("stream");
    expect(classifyStyle({ tags: "", version: "Reverberation", bpm: 220, density: 5.12, circleRatio: 0.65, stars: 7.42 })).toBeNull();
    expect(classifyStyle({ tags: "", version: "Conflagration", bpm: 250, density: 4.32, circleRatio: 0.53, stars: 7.51 })).toBe("jump");
    expect(classifyStyle({ tags: "", version: "Extra", bpm: 278, density: 5.25, circleRatio: 0.64 })).toBeNull();
    expect(classifyStyle({ tags: "", version: "Extra Stage", bpm: 185, density: 6.36, circleRatio: 0.68 })).toBeNull();
    expect(classifyStyle({ tags: "", version: "Phantasm", bpm: 182, density: 7.44, circleRatio: 0.84 })).toBe("stream");
    expect(classifyStyle({ tags: "", version: "Insane", bpm: 180, density: 2.4, circleRatio: 0.6 })).toBe("jump");
    expect(classifyStyle({ tags: "electronic technical", version: "Expert" })).toBe("tech");
    expect(classifyStyle({ tags: "techno hi-tech", version: "Expert" })).toBeNull();
    expect(classifyStyle({ tags: "alternative rock", version: "Insane" })).toBeNull();
    expect(classifyStyle({ tags: "alternate", version: "Expert" })).toBe("alt");
    expect(classifyStyle({ tags: "juke finger control polyrhythm", version: "Beyond" })).toBe("fingercontrol");
    expect(classifyStyle({ tags: "technical", version: "Expert", bpm: 190, density: 7.2, circleRatio: 0.82 })).toBe("stream");
    expect(classifyStyle({ tags: "", version: "Expert", bpm: 150, density: 8.6, circleRatio: 1, stars: 7.9 })).toBe("fingercontrol");
    expect(classifyStyle({ tags: "", version: "Expert", bpm: 270, density: 7.9, circleRatio: 0.71, stars: 8.2 })).toBe("speed");
    expect(classifyStyle({ tags: "", version: "Expert", bpm: 180, density: 4.6, circleRatio: 0.42, stars: 7.3 })).toBe("tech");
    expect(classifyStyle({ tags: "", version: "Expert", bpm: 210, density: 5, circleRatio: 0.77, stars: 7.25 })).toBe("alt");
  });

  it("leaves untagged maps unclassified", () => {
    expect(classifyStyle({ tags: "guest mapper", version: "Uri's Extreme" })).toBeNull();
  });

  it("keeps parent categories and exact subtypes", () => {
    expect(styleMatches("jump", "jump")).toBe(true);
    expect(styleMatches("stream", "speed")).toBe(false);
    expect(styleMatches("stream", "stream")).toBe(true);
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

  it("sorts maps by pp, stars, then length", () => {
    const short = { pp: 500, stars: 6, lengthSeconds: 90 };
    const long = { pp: 510, stars: 5.5, lengthSeconds: 400 };
    const hard = { pp: 505, stars: 8, lengthSeconds: 120 };
    expect([long, short, hard].sort((a, b) => compareDiscover(legacySort("pp-desc"), a, b)).map((map) => map.pp)).toEqual([510, 505, 500]);
    expect([long, short, hard].sort((a, b) => compareDiscover(legacySort("pp-asc"), a, b)).map((map) => map.pp)).toEqual([500, 505, 510]);
    expect([long, short, hard].sort((a, b) => compareDiscover(legacySort("stars-desc"), a, b)).map((map) => map.stars)).toEqual([8, 6, 5.5]);
    expect([long, short, hard].sort((a, b) => compareDiscover(legacySort("stars-asc"), a, b)).map((map) => map.stars)).toEqual([5.5, 6, 8]);
    expect([long, short, hard].sort((a, b) => compareDiscover(legacySort("length-desc"), a, b)).map((map) => map.lengthSeconds)).toEqual([400, 120, 90]);
    expect([long, short, hard].sort((a, b) => compareDiscover(legacySort("length-asc"), a, b)).map((map) => map.lengthSeconds)).toEqual([90, 120, 400]);
  });

  it("puts the farm score first when sorting for farm", () => {
    const a = { pp: 500, stars: 6, lengthSeconds: 90, farm: 40 };
    const b = { pp: 480, stars: 6, lengthSeconds: 90, farm: 80 };
    expect([a, b].sort((x, y) => compareDiscover(legacySort("farm"), x, y))[0]).toBe(b);
  });

  it("sorts by several rules, the first one winning", () => {
    const maps = [
      { pp: 400, stars: 6, lengthSeconds: 90, bpm: 200, ar: 9.3 },
      { pp: 420, stars: 6, lengthSeconds: 80, bpm: 180, ar: 9.3 },
      { pp: 410, stars: 6, lengthSeconds: 70, bpm: 200, ar: 9.7 },
    ];
    const sorted = [...maps].sort((a, b) =>
      compareDiscover(
        [
          { key: "bpm", dir: "desc" },
          { key: "ar", dir: "asc" },
        ],
        a,
        b,
      ),
    );
    expect(sorted.map((map) => map.pp)).toEqual([400, 410, 420]);
  });

  it("puts maps without a value last, whatever the direction", () => {
    const known = { pp: 400, stars: 6, lengthSeconds: 90, ar: 9 };
    const unknown = { pp: 500, stars: 6, lengthSeconds: 90, ar: null };
    expect([unknown, known].sort((a, b) => compareDiscover([{ key: "ar", dir: "asc" }], a, b))[0]).toBe(known);
    expect([unknown, known].sort((a, b) => compareDiscover([{ key: "ar", dir: "desc" }], a, b))[0]).toBe(known);
  });

  it("checks open and closed ranges", () => {
    expect(inRange(9.3, { min: 9, max: 9.5 })).toBe(true);
    expect(inRange(9.8, { min: 9, max: 9.5 })).toBe(false);
    expect(inRange(250, { min: 240, max: null })).toBe(true);
    expect(inRange(null, { min: null, max: null })).toBe(true);
    expect(inRange(null, { min: 1, max: null })).toBe(false);
  });
});
