import type { BeatmapStatus, Mode } from "./types";

/** CL (Classic) = a score set on osu!stable: slider ends do not count, as in the game. */
export const MOD_ORDER = ["EZ", "HD", "HR", "DT", "NC", "HT", "FL", "CL"] as const;
export type ModId = (typeof MOD_ORDER)[number];

const GAMEPLAY_MODS: readonly ModId[] = ["EZ", "HD", "HR", "DT", "NC", "HT", "FL"];

export const MODS_BY_MODE: Record<Mode, readonly ModId[]> = {
  osu: MOD_ORDER,
  taiko: GAMEPLAY_MODS,
  catch: GAMEPLAY_MODS,
  mania: GAMEPLAY_MODS,
};

/** Scores with CL are computed as osu!stable scores (no slider-end accuracy). */
export function isClassic(mods: readonly string[]): boolean {
  return mods.includes("CL");
}

export class InputError extends Error {
  readonly vars?: Record<string, string | number>;

  constructor(message: string, vars?: Record<string, string | number>) {
    super(message);
    this.name = "InputError";
    this.vars = vars;
  }
}

export function assertMods(mods: readonly string[], mode: Mode): ModId[] {
  const allowed = new Set<string>(MODS_BY_MODE[mode]);
  const selected = new Set<string>();

  for (const raw of mods) {
    if (typeof raw !== "string") throw new InputError("mods.invalid");
    const mod = raw.trim().toUpperCase();
    if (!mod) continue;
    if (!allowed.has(mod)) {
      throw new InputError("mods.unavailable", { mod, mode: modeLabel(mode) });
    }
    selected.add(mod);
  }

  if (selected.has("EZ") && selected.has("HR")) {
    throw new InputError("mods.ezhr");
  }
  if ((selected.has("DT") || selected.has("NC")) && selected.has("HT")) {
    throw new InputError("mods.dtht");
  }
  if (selected.has("NC")) selected.delete("DT");

  return MOD_ORDER.filter((mod) => selected.has(mod));
}

export function sanitizeMods(mods: readonly string[], mode: Mode): ModId[] {
  const allowed = new Set<string>(MODS_BY_MODE[mode]);
  const selected = new Set<string>();
  for (const raw of mods) {
    const mod = raw.trim().toUpperCase();
    if (allowed.has(mod)) selected.add(mod);
  }
  if (selected.has("EZ") && selected.has("HR")) selected.delete("HR");
  if (selected.has("NC")) selected.delete("DT");
  if (selected.has("HT")) {
    selected.delete("DT");
    selected.delete("NC");
  }
  return MOD_ORDER.filter((mod) => selected.has(mod));
}

export function toggleMod(current: readonly string[], mod: ModId, mode: Mode): ModId[] {
  const allowed = new Set<string>(MODS_BY_MODE[mode]);
  if (!allowed.has(mod)) return sanitizeMods(current, mode);

  const selected = new Set(sanitizeMods(current, mode));
  if (selected.has(mod)) {
    selected.delete(mod);
    return MOD_ORDER.filter((item) => selected.has(item));
  }

  if (mod === "EZ") selected.delete("HR");
  if (mod === "HR") selected.delete("EZ");
  if (mod === "DT") {
    selected.delete("HT");
    selected.delete("NC");
  }
  if (mod === "NC") {
    selected.delete("HT");
    selected.delete("DT");
  }
  if (mod === "HT") {
    selected.delete("DT");
    selected.delete("NC");
  }
  selected.add(mod);
  return MOD_ORDER.filter((item) => selected.has(item));
}

export function defaultClockRate(mods: readonly string[]): number | null {
  if (mods.includes("HT")) return 0.75;
  if (mods.includes("DT") || mods.includes("NC")) return 1.5;
  return null;
}

/** Clock rate passed to rosu. Undefined keeps the mod default, so DT is not applied twice. */
export function resolveClockRate(mods: readonly string[], clockRate: number | null | undefined): number | undefined {
  const fallback = defaultClockRate(mods);
  if (fallback == null || clockRate == null) return undefined;
  if (!Number.isFinite(clockRate)) throw new InputError("mods.rateInvalid");
  const rounded = Math.round(clockRate * 100) / 100;
  if (rounded < 0.5 || rounded > 2) {
    throw new InputError("mods.rate");
  }
  if (Math.abs(rounded - fallback) < 0.001) return undefined;
  return rounded;
}

export function modeLabel(mode: Mode): string {
  if (mode === "osu") return "osu!";
  return mode;
}

export function normalizeStatus(raw: string | null | undefined): BeatmapStatus {
  switch ((raw ?? "").toLowerCase()) {
    case "ranked":
    case "approved":
    case "qualified":
    case "loved":
    case "pending":
    case "graveyard":
    case "wip":
      return raw!.toLowerCase() as BeatmapStatus;
    default:
      return "unknown";
  }
}

export function apiMode(raw: string | null | undefined): Mode | null {
  switch (raw) {
    case "osu":
    case "taiko":
    case "mania":
      return raw;
    case "fruits":
      return "catch";
    default:
      return null;
  }
}
