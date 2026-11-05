import { describe, expect, it } from "vitest";
import { InputError, assertMods, resolveClockRate, toggleMod } from "@osu-pp/shared";

describe("mods", () => {
  it("orders mods and lets NC replace DT", () => {
    expect(assertMods(["DT", "HD"], "osu")).toEqual(["HD", "DT"]);
    expect(assertMods(["DT", "NC"], "osu")).toEqual(["NC"]);
  });

  it("rejects mods that cannot be combined", () => {
    expect(() => assertMods(["EZ", "HR"], "osu")).toThrow(InputError);
    expect(() => assertMods(["DT", "HT"], "osu")).toThrow(InputError);
    expect(() => assertMods(["NC", "HT"], "taiko")).toThrow(InputError);
    expect(() => assertMods(["SO"], "taiko")).toThrow(InputError);
  });

  it("toggles conflicting mods off", () => {
    expect(toggleMod(["DT", "HD"], "HT", "osu")).toEqual(["HD", "HT"]);
    expect(toggleMod(["DT"], "NC", "osu")).toEqual(["NC"]);
    expect(toggleMod(["HR"], "EZ", "osu")).toEqual(["EZ"]);
    expect(toggleMod(["DT"], "DT", "osu")).toEqual([]);
  });

  it("sends a custom speed once, and omits the default so DT is not applied twice", () => {
    expect(resolveClockRate(["DT"], 1.5)).toBeUndefined();
    expect(resolveClockRate(["NC"], 1.5)).toBeUndefined();
    expect(resolveClockRate(["HT"], 0.75)).toBeUndefined();
    expect(resolveClockRate(["DT"], 1.25)).toBe(1.25);
    expect(resolveClockRate(["HD"], 1.5)).toBeUndefined();
    expect(() => resolveClockRate(["DT"], 3)).toThrow(InputError);
  });
});
