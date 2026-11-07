/**
 * Reads the hit objects of an osu! standard map and measures how it plays:
 * 1/4 chains (bursts, streams), spaced 1/2 movement (jumps), tapping speed,
 * rhythm irregularity and slider use. This is what decides the map type.
 */

import type { PatternProfile } from "@osu-pp/shared";

export const PATTERN_VERSION = 3;

interface TimingPoint {
  time: number;
  beatLength: number;
  uninherited: boolean;
}

interface HitObject {
  x: number;
  y: number;
  endX: number;
  endY: number;
  start: number;
  end: number;
  kind: "circle" | "slider" | "spinner";
}

function sectionLines(text: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = header[1] ?? "";
      map.set(current, []);
      continue;
    }
    map.get(current)?.push(line);
  }
  return map;
}

function keyValue(lines: string[] | undefined, key: string): string | null {
  for (const line of lines ?? []) {
    const index = line.indexOf(":");
    if (index > 0 && line.slice(0, index).trim() === key) return line.slice(index + 1).trim();
  }
  return null;
}

function parseTiming(lines: string[]): TimingPoint[] {
  const points: TimingPoint[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    const time = Number(parts[0]);
    const beatLength = Number(parts[1]);
    if (!Number.isFinite(time) || !Number.isFinite(beatLength)) continue;
    const uninherited = parts[6] == null ? beatLength > 0 : parts[6].trim() === "1";
    points.push({ time, beatLength, uninherited: uninherited && beatLength > 0 });
  }
  points.sort((a, b) => a.time - b.time || Number(b.uninherited) - Number(a.uninherited));
  return points;
}

class Timing {
  private readonly red: TimingPoint[];
  private readonly green: TimingPoint[];

  constructor(points: TimingPoint[]) {
    this.red = points.filter((point) => point.uninherited);
    this.green = points.filter((point) => !point.uninherited);
  }

  get ok(): boolean {
    return this.red.length > 0;
  }

  private last(list: TimingPoint[], time: number): TimingPoint | undefined {
    let low = 0;
    let high = list.length - 1;
    let found: TimingPoint | undefined;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const point = list[mid]!;
      if (point.time <= time + 1) {
        found = point;
        low = mid + 1;
      } else high = mid - 1;
    }
    return found;
  }

  beat(time: number): number {
    return (this.last(this.red, time) ?? this.red[0]!).beatLength;
  }

  sv(time: number): number {
    const red = this.last(this.red, time);
    const green = this.last(this.green, time);
    if (!green || (red && red.time > green.time)) return 1;
    const value = -100 / green.beatLength;
    return Number.isFinite(value) && value > 0 ? Math.min(10, Math.max(0.1, value)) : 1;
  }

  dominantBpm(end: number): number {
    const weights = new Map<number, number>();
    for (let index = 0; index < this.red.length; index += 1) {
      const point = this.red[index]!;
      const next = this.red[index + 1]?.time ?? end;
      const span = Math.max(0, next - point.time);
      const bpm = Math.round(60_000 / point.beatLength);
      weights.set(bpm, (weights.get(bpm) ?? 0) + span);
    }
    let best = 0;
    let bestWeight = -1;
    for (const [bpm, weight] of weights) {
      if (weight > bestWeight) {
        best = bpm;
        bestWeight = weight;
      }
    }
    return best;
  }

  svChanges(start: number, end: number): number {
    let changes = 0;
    let previous = 1;
    for (const point of this.green) {
      if (point.time < start || point.time > end) continue;
      const value = Math.round((-100 / point.beatLength) * 20) / 20;
      if (Math.abs(value - previous) >= 0.05) changes += 1;
      previous = value;
    }
    return changes;
  }
}

function parseObjects(lines: string[], timing: Timing, multiplier: number): HitObject[] {
  const objects: HitObject[] = [];
  for (const line of lines) {
    const parts = line.split(",");
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const start = Number(parts[2]);
    const type = Number(parts[3]);
    if (![x, y, start, type].every(Number.isFinite)) continue;
    if (type & 8) {
      objects.push({ x, y, endX: x, endY: y, start, end: Number(parts[5]) || start, kind: "spinner" });
      continue;
    }
    if (type & 2) {
      const curve = (parts[5] ?? "").split("|").slice(1);
      const slides = Math.max(1, Number(parts[6]) || 1);
      const length = Math.max(0, Number(parts[7]) || 0);
      const last = curve[curve.length - 1]?.split(":");
      const lastX = last ? Number(last[0]) : x;
      const lastY = last ? Number(last[1]) : y;
      const odd = slides % 2 === 1;
      const velocity = multiplier * 100 * timing.sv(start);
      const duration = velocity > 0 ? (length / velocity) * timing.beat(start) * slides : 0;
      objects.push({
        x,
        y,
        endX: odd && Number.isFinite(lastX) ? lastX : x,
        endY: odd && Number.isFinite(lastY) ? lastY : y,
        start,
        end: start + duration,
        kind: "slider",
      });
      continue;
    }
    objects.push({ x, y, endX: x, endY: y, start, end: start, kind: "circle" });
  }
  objects.sort((a, b) => a.start - b.start);
  return objects;
}

const GRID = [0.25, 0.5, 0.75, 1, 1.5, 2];
const CLASSES = [1 / 8, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1, 1.5, 2];

function onGrid(beats: number): boolean {
  if (beats > 2.05) return true;
  return GRID.some((step) => Math.abs(beats - step) <= 0.035);
}

function rhythmClass(beats: number): number {
  let best = -1;
  let delta = Infinity;
  for (let index = 0; index < CLASSES.length; index += 1) {
    const value = Math.abs(beats - CLASSES[index]!);
    if (value < delta) {
      delta = value;
      best = index;
    }
  }
  return delta <= 0.04 ? best : CLASSES.length;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function analyzePatterns(text: string): PatternProfile | null {
  const parts = sectionLines(text.replace(/^﻿/, ""));
  const mode = keyValue(parts.get("General"), "Mode");
  if (mode != null && mode !== "0") return null;
  const timing = new Timing(parseTiming(parts.get("TimingPoints") ?? []));
  if (!timing.ok) return null;
  const difficulty = parts.get("Difficulty");
  const cs = Number(keyValue(difficulty, "CircleSize") ?? 5);
  const multiplier = Number(keyValue(difficulty, "SliderMultiplier") ?? 1.4) || 1.4;
  const radius = Math.max(8, 54.4 - 4.48 * (Number.isFinite(cs) ? cs : 5));

  const all = parseObjects(parts.get("HitObjects") ?? [], timing, multiplier);
  const objects = all.filter((object) => object.kind !== "spinner");
  if (objects.length < 20) return null;

  const first = objects[0]!.start;
  const lastEnd = objects[objects.length - 1]!.end;
  let breaks = 0;
  for (const line of parts.get("Events") ?? []) {
    const event = line.split(",");
    if (event[0] === "2" || event[0] === "Break") {
      const from = Number(event[1]);
      const to = Number(event[2]);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) breaks += to - from;
    }
  }
  const drainMs = Math.max(1000, lastEnd - first - breaks);

  // Some maps are timed at half or double their felt BPM. Rescale beats so
  // 1/8 streams at 100 BPM read as 1/4 at 200, and 1/2 at 360 as 1/4 at 180.
  let eighths = 0;
  let quarters = 0;
  let pairs = 0;
  for (let index = 1; index < objects.length; index += 1) {
    const previous = objects[index - 1]!;
    if (previous.kind !== "circle") continue;
    const beats = (objects[index]!.start - previous.start) / timing.beat(objects[index]!.start);
    if (beats > 2.05) continue;
    pairs += 1;
    if (Math.abs(beats - 0.125) <= 0.02 || Math.abs(beats - 0.375) <= 0.02) eighths += 1;
    if (beats <= 0.3) quarters += 1;
  }
  const rawBpm = timing.dominantBpm(lastEnd);
  let scale = 1;
  if (pairs > 0 && eighths / pairs >= 0.12) scale = 2;
  else if (rawBpm >= 300 && pairs > 0 && quarters / pairs < 0.03) scale = 0.5;

  let streamNotes = 0;
  let burstNotes = 0;
  let doubleNotes = 0;
  let longest = 0;
  let streamDistance = 0;
  let streamMoves = 0;
  let jumps = 0;
  let jumpDistance = 0;
  let speedJumps = 0;
  let sliders = 0;
  let irregular = 0;
  let taps = 0;
  const classCounts = new Array<number>(CLASSES.length + 1).fill(0);

  let chain = 1;
  let chainDistance = 0;
  const closeChain = () => {
    if (chain >= 9) {
      streamNotes += chain;
      streamDistance += chainDistance;
      streamMoves += chain - 1;
    } else if (chain >= 3) burstNotes += chain;
    else if (chain === 2) doubleNotes += 2;
    if (chain > longest) longest = chain;
    chain = 1;
    chainDistance = 0;
  };

  for (let index = 0; index < objects.length; index += 1) {
    const current = objects[index]!;
    if (current.kind === "slider") sliders += 1;
    const previous = objects[index - 1];
    if (!previous) continue;
    const beat = timing.beat(current.start) / scale;
    const tap = current.start - previous.start;
    const tapBeats = tap / beat;
    const move = previous.kind === "slider" ? current.start - previous.end : tap;
    const moveBeats = move / beat;
    const distance = Math.hypot(current.x - previous.endX, current.y - previous.endY) / radius;

    if (tapBeats <= 2.05) {
      taps += 1;
      classCounts[rhythmClass(tapBeats)]! += 1;
      if (!onGrid(tapBeats)) irregular += 1;
    }

    const quarter = previous.kind === "circle" && tapBeats <= 0.3 && tap <= 150;
    const triplet = previous.kind === "circle" && tapBeats <= 0.36 && tap <= 105;
    const blur = previous.kind === "circle" && tap <= 90;
    if (quarter || triplet || blur) {
      chain += 1;
      chainDistance += distance;
    } else {
      closeChain();
    }

    if (moveBeats >= 0.4 && moveBeats <= 1.05 && distance >= 3) {
      jumps += 1;
      jumpDistance += distance;
      if (tap <= 125 && tapBeats >= 0.4) speedJumps += 1;
    }
  }
  closeChain();

  const n = objects.length;
  let entropy = 0;
  if (taps > 0) {
    for (const count of classCounts) {
      if (count === 0) continue;
      const p = count / taps;
      entropy -= p * Math.log2(p);
    }
  }

  return {
    v: PATTERN_VERSION,
    objects: n,
    bpm: Math.round(rawBpm * scale),
    streamShare: round(streamNotes / n),
    burstShare: round(burstNotes / n),
    doubleShare: round(doubleNotes / n),
    longestStream: longest,
    streamSpacing: round(streamMoves > 0 ? streamDistance / streamMoves : 0, 2),
    jumpShare: round(jumps / n),
    jumpSpacing: round(jumps > 0 ? jumpDistance / jumps : 0, 2),
    speedShare: round(speedJumps / n),
    sliderShare: round(sliders / n),
    irregularShare: round(taps > 0 ? irregular / taps : 0),
    rhythmEntropy: round(entropy, 2),
    svChanges: round(timing.svChanges(first, lastEnd) / (drainMs / 60_000), 1),
    drain: Math.round(drainMs / 1000),
  };
}
