export const FINDER_MODS = ["EZ", "HD", "HR", "DT", "HT", "FL"] as const;
export type FinderMod = (typeof FINDER_MODS)[number];
export type ModChoice = "off" | "on" | "any";

/** Precomputed combinations. NF, SO and NC are absent: NF and SO do not change PP, and NC matches DT. */
export const PP_COMBOS = [
  "NM",
  "HD",
  "HR",
  "DT",
  "FL",
  "HDHR",
  "HDDT",
  "HRDT",
  "HRFL",
  "HDFL",
  "DTFL",
  "HDHRDT",
  "HDHRFL",
  "HRDTFL",
  "HDDTFL",
  "HDHRDTFL",
  "EZ",
  "EZHD",
  "EZDT",
  "EZFL",
  "EZHDDT",
  "EZHDFL",
  "EZDTFL",
  "EZHDDTFL",
  "HT",
  "HDHT",
  "HRHT",
  "HDHRHT",
  "HTFL",
  "HDHTFL",
  "HRHTFL",
  "HDHRHTFL",
  "EZHT",
  "EZHDHT",
  "EZHTFL",
  "EZHDHTFL",
] as const;

const MOD_TOKENS = ["EZ", "HD", "HR", "DT", "HT", "FL"] as const;

export function emptyFilters(): Record<FinderMod, ModChoice> {
  return { EZ: "off", HD: "off", HR: "off", DT: "off", HT: "off", FL: "off" };
}

export function cycleChoice(choice: ModChoice): ModChoice {
  if (choice === "off") return "on";
  if (choice === "on") return "any";
  return "off";
}

export function modsInCombo(combo: string): FinderMod[] {
  if (combo === "NM") return [];
  const found: FinderMod[] = [];
  let rest = combo;
  while (rest.length > 0) {
    const token = MOD_TOKENS.find((mod) => rest.startsWith(mod));
    if (!token) throw new Error(`Unknown PP combo: ${combo}`);
    found.push(token);
    rest = rest.slice(token.length);
  }
  return found;
}

export function matchingCombos(filters: Record<FinderMod, ModChoice>): string[] {
  return PP_COMBOS.filter((combo) => {
    const present = new Set(modsInCombo(combo));
    return FINDER_MODS.every((mod) => {
      if (filters[mod] === "on") return present.has(mod);
      if (filters[mod] === "off") return !present.has(mod);
      return true;
    });
  });
}
