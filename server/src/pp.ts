import type { CalculateRequest, CurvePoint, MapStats, Mode, ScoreResult } from "@osu-pp/shared";
import { assertMods, InputError, isClassic, resolveClockRate, sanitizeMods } from "@osu-pp/shared";
import {
  Beatmap,
  BeatmapAttributesBuilder,
  Difficulty,
  type DifficultyAttributes,
  GameMode,
  HitResultGenerator,
  Performance,
} from "rosu-pp-js";
import { AppError } from "./errors";
import { tr } from "./locale";
import { gameModeToMode, getDifficulty, loadBeatmapFile, openBeatmap } from "./beatmapCache";

const FC_ACCURACIES = [100, 99, 98, 97, 95];

export interface PlayResult {
  mode: Mode;
  stats: MapStats;
  curve: CurvePoint[];
  score: ScoreResult;
  warnings: string[];
  endMs: number;
  clockRate: number;
}

interface PerfParts {
  pp: number;
  aim: number | null;
  speed: number | null;
  accuracyPp: number | null;
  flashlight: number | null;
  difficultyPp: number | null;
}

function asError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof InputError) return new AppError("invalid", tr(error.message, error.vars), 400);
  throw error;
}

function modArg(mods: string[]): { acronym: string }[] {
  return mods.map((acronym) => ({ acronym }));
}

function readPerf(attrs: { pp: number; ppAim?: number; ppSpeed?: number; ppAccuracy?: number; ppFlashlight?: number; ppDifficulty?: number }): PerfParts {
  return {
    pp: attrs.pp,
    aim: attrs.ppAim ?? null,
    speed: attrs.ppSpeed ?? null,
    accuracyPp: attrs.ppAccuracy ?? null,
    flashlight: attrs.ppFlashlight ?? null,
    difficultyPp: attrs.ppDifficulty ?? null,
  };
}

function runPerf(
  difficulty: DifficultyAttributes,
  mods: { acronym: string }[],
  clockRate: number | undefined,
  play: { accuracy: number; combo: number | null; misses: number },
): PerfParts {
  const perf = new Performance({
    mods,
    clockRate,
    // CL = an osu!stable score; everything else is scored like osu!lazer.
    lazer: !isClassic(mods.map((mod) => mod.acronym)),
    accuracy: play.accuracy,
    misses: play.misses,
    ...(play.combo != null ? { combo: play.combo } : {}),
  });
  // From an accuracy alone, "Closest" picks the 300/100/50 split that matches it best: on 100
  // real top plays it lands within 0.65 % of osu!'s pp on average, against ~6 % with "Fast".
  perf.setHitresultGenerator(HitResultGenerator.Closest, GameMode.Osu);
  try {
    const attrs = perf.calculate(difficulty);
    try {
      return readPerf(attrs);
    } finally {
      attrs.free();
    }
  } finally {
    perf.free();
  }
}

function mapStats(
  map: Beatmap,
  difficulty: DifficultyAttributes,
  mods: { acronym: string }[],
  clockRate: number | undefined,
  endMs: number,
): { stats: MapStats; rate: number } {
  const builder = new BeatmapAttributesBuilder({ map, mods, clockRate });
  const built = builder.build();
  const rate = built.clockRate > 0 ? built.clockRate : 1;
  const stats: MapStats = {
    stars: difficulty.stars,
    maxCombo: difficulty.maxCombo,
    ar: built.ar,
    od: built.od,
    cs: built.cs,
    hp: built.hp,
    bpm: map.bpm * rate,
    lengthSeconds: endMs > 0 ? endMs / 1000 / rate : 0,
  };
  built.free();
  return { rate, stats };
}

export async function calculatePlay(
  input: CalculateRequest,
  nativeMode: Mode,
  endMs = 0,
  tolerant = false,
): Promise<PlayResult> {
  try {
    await loadBeatmapFile(input.beatmapId);
    const mode = input.mode ?? nativeMode;
    const map = openBeatmap(input.beatmapId, mode);
    return compute(input.beatmapId, map, mode, input, endMs, tolerant);
  } catch (error) {
    throw asError(error);
  }
}

function compute(
  beatmapId: number,
  map: Beatmap,
  mode: Mode,
  input: CalculateRequest,
  endMs: number,
  tolerant: boolean,
): PlayResult {
  const mods = tolerant ? sanitizeMods(input.mods, mode) : assertMods(input.mods, mode);
  const clockRate = resolveClockRate(mods, input.clockRate);
  const modsArg = modArg(mods);
  const diffKey = `${mode}|${mods.join(".")}|${clockRate ?? "mod"}`;

  const difficulty = getDifficulty(beatmapId, diffKey, () => {
    const calculator = new Difficulty({ mods: modsArg, clockRate, lazer: !isClassic(mods) });
    try {
      return calculator.calculate(map);
    } catch {
      throw new AppError("invalid", tr("map.mods"), 400);
    } finally {
      calculator.free();
    }
  });

  if (input.misses > map.nObjects) {
    throw new AppError("invalid", tr("map.misses", { count: map.nObjects }), 400);
  }

  const warnings: string[] = [];
  let combo = input.combo;
  if (combo != null && combo > difficulty.maxCombo) {
    warnings.push(tr("map.combo", { combo: difficulty.maxCombo }));
    combo = difficulty.maxCombo;
  }

  const curve = FC_ACCURACIES.map((accuracy) => {
    const parts = runPerf(difficulty, modsArg, clockRate, { accuracy, combo: null, misses: 0 });
    return { accuracy, pp: parts.pp };
  });

  const custom = runPerf(difficulty, modsArg, clockRate, {
    accuracy: input.accuracy,
    combo,
    misses: input.misses,
  });
  const { stats, rate } = mapStats(map, difficulty, modsArg, clockRate, endMs);

  return {
    mode,
    stats,
    curve,
    warnings,
    clockRate: rate,
    endMs,
    score: {
      accuracy: input.accuracy,
      combo: combo ?? difficulty.maxCombo,
      misses: input.misses,
      pp: custom.pp,
      aim: custom.aim,
      speed: custom.speed,
      accuracyPp: custom.accuracyPp,
      flashlight: custom.flashlight,
      difficultyPp: custom.difficultyPp,
    },
  };
}

/** Used by tests. Parses a map, calculates, then frees it. */
export function calculateFixture(bytes: Uint8Array, input: Omit<CalculateRequest, "beatmapId"> & { endMs?: number }): PlayResult {
  const map = new Beatmap(bytes);
  try {
    if (map.isSuspicious()) {
      throw new AppError("suspicious", tr("map.suspicious"), 422);
    }
    const mode = input.mode ?? gameModeToMode(map.mode);
    if (gameModeToMode(map.mode) !== mode) map.convert(mode === "osu" ? 0 : mode === "taiko" ? 1 : mode === "catch" ? 2 : 3);
    const mods = assertMods(input.mods, mode);
    const clockRate = resolveClockRate(mods, input.clockRate);
    const modsArg = modArg(mods);
    const calculator = new Difficulty({ mods: modsArg, clockRate, lazer: !isClassic(mods) });
    let difficulty: DifficultyAttributes;
    try {
      difficulty = calculator.calculate(map);
    } finally {
      calculator.free();
    }
    try {
      const warnings: string[] = [];
      let combo = input.combo;
      if (combo != null && combo > difficulty.maxCombo) {
        warnings.push(tr("map.combo", { combo: difficulty.maxCombo }));
        combo = difficulty.maxCombo;
      }
      if (input.misses > map.nObjects) {
        throw new AppError("invalid", tr("map.misses", { count: map.nObjects }), 400);
      }
      const curve = FC_ACCURACIES.map((accuracy) => ({
        accuracy,
        pp: runPerf(difficulty, modsArg, clockRate, { accuracy, combo: null, misses: 0 }).pp,
      }));
      const custom = runPerf(difficulty, modsArg, clockRate, {
        accuracy: input.accuracy,
        combo,
        misses: input.misses,
      });
      const { stats, rate } = mapStats(map, difficulty, modsArg, clockRate, input.endMs ?? 2500);
      return {
        mode,
        stats,
        curve,
        warnings,
        clockRate: rate,
        endMs: input.endMs ?? 2500,
        score: {
          accuracy: input.accuracy,
          combo: combo ?? difficulty.maxCombo,
          misses: input.misses,
          pp: custom.pp,
          aim: custom.aim,
          speed: custom.speed,
          accuracyPp: custom.accuracyPp,
          flashlight: custom.flashlight,
          difficultyPp: custom.difficultyPp,
        },
      };
    } finally {
      difficulty.free();
    }
  } finally {
    map.free();
  }
}
