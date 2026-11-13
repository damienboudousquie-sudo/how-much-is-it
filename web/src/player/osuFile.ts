/** Minimal .osu reader for the auto player (all four modes): hit objects, timing, colours. */

export interface Point {
  x: number;
  y: number;
}

export interface TimingPoint {
  time: number;
  beatLength: number;
  uninherited: boolean;
  sampleSet: number;
  volume: number;
}

export interface HitObject {
  /** "hold": an osu!mania long note (endTime = its end). */
  kind: "circle" | "slider" | "spinner" | "hold";
  x: number;
  y: number;
  time: number;
  endTime: number;
  newCombo: boolean;
  comboSkip: number;
  sound: number;
  // sliders
  curve: string;
  points: Point[];
  slides: number;
  length: number;
  edges: number[] | null;
  path: Point[];
  cum: number[];
  slideTime: number;
  tickDist: number;
  beat: number;
  // filled by prepare()
  combo: number;
  colour: number;
  stack: number;
}

export interface OsuMap {
  /** 0 osu!, 1 taiko, 2 catch, 3 mania (the map's own mode). */
  mode: number;
  title: string;
  artist: string;
  version: string;
  previewTime: number;
  sampleSet: string;
  stackLeniency: number;
  cs: number;
  ar: number;
  od: number;
  sliderMultiplier: number;
  tickRate: number;
  timing: TimingPoint[];
  objects: HitObject[];
  start: number;
  duration: number;
}

export function parseOsu(text: string): OsuMap {
  let section = "";
  const meta: Record<string, string> = {};
  const diff: Record<string, string> = {};
  const timing: TimingPoint[] = [];
  const objects: HitObject[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }
    if (section === "General" || section === "Metadata" || section === "Difficulty") {
      const at = line.indexOf(":");
      if (at > 0) (section === "Difficulty" ? diff : meta)[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    } else if (section === "TimingPoints") {
      const p = line.split(",");
      if (p.length < 2) continue;
      timing.push({
        time: Number(p[0]),
        beatLength: Number(p[1]),
        uninherited: p.length < 7 ? true : p[6] === "1",
        sampleSet: Number(p[3] ?? 0),
        volume: Number(p[5] ?? 100),
      });
    } else if (section === "HitObjects") {
      const p = line.split(",");
      if (p.length < 4) continue;
      const type = Number(p[3]);
      const base: HitObject = {
        kind: "circle",
        x: Number(p[0]),
        y: Number(p[1]),
        time: Number(p[2]),
        endTime: Number(p[2]),
        newCombo: (type & 4) !== 0,
        comboSkip: (type >> 4) & 7,
        sound: Number(p[4] ?? 0),
        curve: "",
        points: [],
        slides: 1,
        length: 0,
        edges: null,
        path: [],
        cum: [],
        slideTime: 0,
        tickDist: 0,
        beat: 500,
        combo: 0,
        colour: 0,
        stack: 0,
      };
      if (type & 2) {
        const [kind, ...pts] = (p[5] ?? "L").split("|");
        base.kind = "slider";
        base.curve = kind;
        base.points = [{ x: base.x, y: base.y }, ...pts.map((item) => {
          const [x, y] = item.split(":");
          return { x: Number(x), y: Number(y) };
        })];
        base.slides = Math.max(1, Number(p[6] ?? 1));
        base.length = Math.max(0, Number(p[7] ?? 0));
        base.edges = p[8] ? p[8].split("|").map(Number) : null;
      } else if (type & 128) {
        // osu!mania long note: the end time leads the extras field ("end:sampleset:…").
        base.kind = "hold";
        base.endTime = Math.max(base.time, Number((p[5] ?? "").split(":")[0]) || base.time);
      } else if (type & 8) {
        base.kind = "spinner";
        base.x = 256;
        base.y = 192;
        base.endTime = Number(p[5] ?? base.time);
      }
      objects.push(base);
    }
  }
  const map: OsuMap = {
    mode: Number(meta.Mode ?? 0) || 0,
    title: meta.Title ?? "",
    artist: meta.Artist ?? "",
    version: meta.Version ?? "",
    previewTime: Number(meta.PreviewTime ?? -1),
    sampleSet: meta.SampleSet ?? "Normal",
    stackLeniency: Number(meta.StackLeniency ?? 0.7),
    cs: Number(diff.CircleSize ?? 4),
    ar: Number(diff.ApproachRate ?? diff.OverallDifficulty ?? 8),
    sliderMultiplier: Number(diff.SliderMultiplier ?? 1.4),
    od: Number(diff.OverallDifficulty ?? 5),
    tickRate: Number(diff.SliderTickRate ?? 1),
    timing,
    objects,
    start: 0,
    duration: 0,
  };
  prepare(map);
  return map;
}

function prepare(map: OsuMap): void {
  let combo = 0;
  let colour = -1;
  for (const o of map.objects) {
    if (o.newCombo || colour < 0) {
      colour += 1 + (colour < 0 ? 0 : o.comboSkip);
      combo = 0;
    }
    if (o.kind !== "spinner") combo += 1;
    o.combo = combo;
    o.colour = colour;
    if (o.kind === "slider") {
      let beat = 500;
      let sv = 1;
      for (const tp of map.timing) {
        if (tp.time > o.time) break;
        if (tp.uninherited) {
          beat = tp.beatLength;
          sv = 1;
        } else if (tp.beatLength < 0) sv = Math.min(10, Math.max(0.1, -100 / tp.beatLength));
      }
      const velocity = map.sliderMultiplier * 100 * sv;
      o.beat = beat;
      o.slideTime = (o.length / velocity) * beat;
      o.endTime = o.time + o.slideTime * o.slides;
      o.tickDist = velocity / (map.tickRate || 1);
      buildPath(o);
    }
  }
  const last = map.objects[map.objects.length - 1];
  map.duration = last ? last.endTime + 800 : 1000;
  map.start = map.objects.length ? Math.max(0, map.objects[0].time - 1500) : 0;
}

// ---------- slider paths ----------

function bezier(pts: Point[]): Point[] {
  const out: Point[] = [];
  const n = Math.max(8, Math.min(64, pts.length * 12));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const tmp = pts.map((p) => ({ ...p }));
    for (let k = tmp.length - 1; k > 0; k--) {
      for (let j = 0; j < k; j++) tmp[j] = { x: tmp[j].x + (tmp[j + 1].x - tmp[j].x) * t, y: tmp[j].y + (tmp[j + 1].y - tmp[j].y) * t };
    }
    out.push(tmp[0]);
  }
  return out;
}

function arc(a: Point, b: Point, c: Point): Point[] | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-3) return null;
  const sq = (p: Point) => p.x * p.x + p.y * p.y;
  const ux = (sq(a) * (b.y - c.y) + sq(b) * (c.y - a.y) + sq(c) * (a.y - b.y)) / d;
  const uy = (sq(a) * (c.x - b.x) + sq(b) * (a.x - c.x) + sq(c) * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - ux, a.y - uy);
  const t0 = Math.atan2(a.y - uy, a.x - ux);
  const t1 = Math.atan2(b.y - uy, b.x - ux);
  const t2 = Math.atan2(c.y - uy, c.x - ux);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(t1 - t0) < norm(t2 - t0);
  const sweep = ccw ? norm(t2 - t0) : -norm(t0 - t2);
  const n = Math.max(8, Math.ceil((Math.abs(sweep) * r) / 6));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = t0 + (sweep * i) / n;
    out.push({ x: ux + r * Math.cos(t), y: uy + r * Math.sin(t) });
  }
  return out;
}

function catmull(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    for (let s = 0; s < 12; s++) {
      const t = s / 12;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function buildPath(o: HitObject): void {
  const pts = o.points;
  let raw: Point[] = [];
  if (o.curve === "P" && pts.length === 3) raw = arc(pts[0], pts[1], pts[2]) ?? bezier(pts);
  else if (o.curve === "L") raw = pts;
  else if (o.curve === "C") raw = catmull(pts);
  else {
    let seg: Point[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      seg.push(pts[i]);
      const next = pts[i + 1];
      if (next && next.x === pts[i].x && next.y === pts[i].y) {
        raw.push(...bezier(seg));
        seg = [];
      }
    }
    if (seg.length > 1) raw.push(...bezier(seg));
  }
  if (raw.length === 0) raw = [pts[0]];
  // Cut (or extend) the path to the slider's real length.
  const path: Point[] = [raw[0]];
  let total = 0;
  for (let i = 1; i < raw.length && total < o.length; i++) {
    const a = path[path.length - 1];
    const b = raw[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-6) continue;
    if (total + d >= o.length) {
      const k = (o.length - total) / d;
      path.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      total = o.length;
      break;
    }
    path.push(b);
    total += d;
  }
  if (total < o.length && path.length > 1) {
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const extra = o.length - total;
    path.push({ x: b.x + ((b.x - a.x) / d) * extra, y: b.y + ((b.y - a.y) / d) * extra });
  }
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  o.path = path;
  o.cum = cum;
}

export function pointAt(o: HitObject, dist: number): Point {
  const { path, cum } = o;
  if (path.length === 0) return { x: o.x, y: o.y };
  if (dist <= 0) return path[0];
  const end = cum[cum.length - 1];
  if (dist >= end) return path[path.length - 1];
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= dist) lo = mid;
    else hi = mid;
  }
  const k = (dist - cum[lo]) / (cum[hi] - cum[lo] || 1);
  return { x: path[lo].x + (path[hi].x - path[lo].x) * k, y: path[lo].y + (path[hi].y - path[lo].y) * k };
}
