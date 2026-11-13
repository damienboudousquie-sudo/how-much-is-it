import { pointAt, type HitObject, type OsuMap } from "./osuFile";

/**
 * Auto play for the three other modes, drawn on the same canvas as osu! (standard): taiko
 * (a drum lane scrolling to the left), catch (fruits falling into a catcher that never
 * misses) and mania (notes falling into the keys). Stateless: each frame is drawn from the
 * map and the time alone, so seeking and the music clock just work.
 */

const PINK = "#ff66aa";
const DON = "#eb452c";
const KAT = "#448dab";
const ROLL = "#fcb806";

export interface ModeView {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  colours: string[];
}

function comboAt(map: OsuMap, t: number): number {
  let combo = 0;
  for (const o of map.objects) {
    if (o.time > t) break;
    if (o.kind !== "spinner") combo += 1;
  }
  return combo;
}

function drawCombo(v: ModeView, combo: number, x: number, y: number, size: number): void {
  if (combo <= 0) return;
  const { ctx } = v;
  ctx.save();
  ctx.font = `800 ${Math.round(size)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(`${combo}x`, x, y);
  ctx.restore();
}

/* ---------- taiko ---------- */

/** Scroll speed of an object, in beats on screen: the BPM and slider velocity there. */
function taikoWindow(map: OsuMap, time: number): number {
  let beat = 500;
  let sv = 1;
  for (const tp of map.timing) {
    if (tp.time > time + 1) break;
    if (tp.uninherited) {
      beat = tp.beatLength;
      sv = 1;
    } else if (tp.beatLength < 0) sv = Math.min(10, Math.max(0.1, -100 / tp.beatLength));
  }
  // Four beats across the lane at 1.4 slider multiplier and SV 1.
  return (beat * 3.2 * 1.4) / (map.sliderMultiplier * sv);
}

export function drawTaiko(v: ModeView, map: OsuMap, t: number): void {
  const { ctx, width: W, height: H } = v;
  ctx.clearRect(0, 0, W, H);
  const laneH = Math.min(H * 0.26, W * 0.17);
  const laneY = H * 0.45;
  const hitX = Math.max(laneH * 1.6, W * 0.22);
  const r = laneH * 0.26;

  // Lane and hit target.
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.fillRect(0, laneY - laneH / 2, W, laneH);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, laneY - laneH / 2, hitX - laneH * 0.62, laneH);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2 * v.dpr;
  ctx.beginPath();
  ctx.arc(hitX, laneY, r * 1.12, 0, Math.PI * 2);
  ctx.stroke();

  const visible: HitObject[] = [];
  for (const o of map.objects) {
    const window = taikoWindow(map, o.time);
    if (o.time - window > t) break;
    if (o.endTime + 120 < t) continue;
    visible.push(o);
  }
  // Drum flash on the latest hit.
  let lastHit: HitObject | null = null;
  for (const o of map.objects) {
    if (o.time > t) break;
    lastHit = o;
  }
  if (lastHit && t - lastHit.time < 120 && lastHit.kind === "circle") {
    const kat = (lastHit.sound & (2 | 8)) !== 0;
    ctx.fillStyle = kat ? "rgba(68,141,171,0.45)" : "rgba(235,69,44,0.45)";
    ctx.beginPath();
    ctx.arc(hitX, laneY, r * 1.12 * (1 + (t - lastHit.time) / 400), 0, Math.PI * 2);
    ctx.fill();
  }

  const xOf = (time: number, at: number) => hitX + ((time - t) / taikoWindow(map, at)) * (W - hitX);
  for (let i = visible.length - 1; i >= 0; i--) {
    const o = visible[i];
    const big = (o.sound & 4) !== 0;
    const radius = big ? r * 1.45 : r;
    if (o.kind === "slider") {
      // Drumroll: a yellow bar from start to end.
      const x1 = Math.max(hitX, xOf(o.time, o.time));
      const x2 = xOf(o.endTime, o.time);
      if (x2 < hitX) continue;
      ctx.fillStyle = ROLL;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x2, laneY, radius * 0.8, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x1, laneY + radius * 0.8);
      ctx.arc(x1, laneY, radius * 0.8, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      continue;
    }
    if (o.kind === "spinner") {
      // Denden: a big circle that shrinks at the target while it lasts.
      if (t < o.time) {
        const x = xOf(o.time, o.time);
        ctx.fillStyle = "#d6d6d6";
        ctx.beginPath();
        ctx.arc(x, laneY, r * 1.2, 0, Math.PI * 2);
        ctx.fill();
      } else if (t <= o.endTime) {
        const k = 1 - (t - o.time) / Math.max(1, o.endTime - o.time);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4 * v.dpr;
        ctx.beginPath();
        ctx.arc(hitX, laneY + laneH * 1.4, laneH * (0.3 + 0.7 * k), 0, Math.PI * 2);
        ctx.stroke();
      }
      continue;
    }
    if (o.time < t) continue;
    const x = xOf(o.time, o.time);
    if (x > W + radius) continue;
    const kat = (o.sound & (2 | 8)) !== 0;
    ctx.fillStyle = kat ? KAT : DON;
    ctx.beginPath();
    ctx.arc(x, laneY, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(2, radius * 0.16);
    ctx.stroke();
  }
  drawCombo(v, comboAt(map, t), (hitX - laneH * 0.62) / 2, laneY, laneH * 0.3);
}

/* ---------- catch ---------- */

interface Fruit {
  time: number;
  x: number;
  size: number; // 1 fruit, 0.5 drop, 0.3 droplet
  colour: number;
}

const fruitCache = new WeakMap<OsuMap, Fruit[]>();

/** Fruits, drops and droplets of a catch map, sorted by time (spinners' bananas left out). */
function fruitsOf(map: OsuMap): Fruit[] {
  const kept = fruitCache.get(map);
  if (kept) return kept;
  const out: Fruit[] = [];
  for (const o of map.objects) {
    if (o.kind === "circle") out.push({ time: o.time, x: o.x, size: 1, colour: o.colour });
    else if (o.kind === "slider" && o.path.length > 1) {
      const span = o.slideTime * o.slides;
      const step = Math.max(40, o.beat / 4);
      for (let at = 0; at <= span + 1; at += step) {
        const pass = Math.min(o.slides - 1, Math.floor(at / Math.max(1, o.slideTime)));
        const within = (at - pass * o.slideTime) / Math.max(1, o.slideTime);
        const f = pass % 2 ? 1 - within : within;
        const p = pointAt(o, Math.max(0, Math.min(1, f)) * o.length);
        const edge = at === 0 || Math.abs(at % o.slideTime) < 1 || at >= span - 1;
        out.push({ time: o.time + at, x: p.x, size: edge ? 1 : 0.35, colour: o.colour });
      }
      const end = pointAt(o, (o.slides % 2 ? 1 : 0) * o.length);
      out.push({ time: o.time + span, x: end.x, size: 1, colour: o.colour });
    }
  }
  out.sort((a, b) => a.time - b.time);
  fruitCache.set(map, out);
  return out;
}

export function drawCatch(v: ModeView, map: OsuMap, t: number, preempt: number): void {
  const { ctx, width: W, height: H } = v;
  ctx.clearRect(0, 0, W, H);
  const fieldW = Math.min(W * 0.92, H * 1.25);
  const left = (W - fieldW) / 2;
  const scale = fieldW / 512;
  const catchY = H * 0.86;
  const fruitR = Math.max(6, (54.4 - 4.48 * map.cs) * scale * 0.55);
  const fruits = fruitsOf(map);

  // Catcher: right under the fruit being caught, moving straight between fruits.
  let lo = 0;
  let hi = fruits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fruits[mid].time <= t) lo = mid + 1;
    else hi = mid;
  }
  const prev = fruits[lo - 1];
  const next = fruits[lo];
  let cx = 256;
  if (prev && next) cx = prev.x + (next.x - prev.x) * Math.min(1, (t - prev.time) / Math.max(1, next.time - prev.time));
  else if (next) cx = next.x;
  else if (prev) cx = prev.x;

  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = v.dpr;
  ctx.strokeRect(left, 0, fieldW, H);

  for (let i = lo; i < fruits.length; i++) {
    const f = fruits[i];
    if (f.time - preempt > t) break;
    const k = 1 - (f.time - t) / preempt;
    const y = catchY * k;
    const x = left + f.x * scale;
    ctx.fillStyle = v.colours[f.colour % v.colours.length] ?? PINK;
    ctx.beginPath();
    ctx.arc(x, y, fruitR * f.size, 0, Math.PI * 2);
    ctx.fill();
    if (f.size >= 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1.5, fruitR * 0.12);
      ctx.stroke();
    }
  }

  // Plate.
  const plateW = fruitR * 4.2;
  const x = left + cx * scale;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(x - plateW / 2, catchY + fruitR * 0.6, plateW, fruitR * 0.55, fruitR * 0.3);
  ctx.fill();
  ctx.fillStyle = PINK;
  ctx.fillRect(x - plateW * 0.08, catchY + fruitR * 1.15, plateW * 0.16, fruitR * 0.9);
  // Fruits just caught sit on the plate for a moment.
  for (let i = lo - 1; i >= 0 && t - fruits[i].time < 160; i--) {
    const f = fruits[i];
    if (f.size < 1) continue;
    const off = (f.x - cx) * scale * 0.25;
    ctx.globalAlpha = 1 - (t - f.time) / 160;
    ctx.fillStyle = v.colours[f.colour % v.colours.length] ?? PINK;
    ctx.beginPath();
    ctx.arc(x + Math.max(-plateW / 2.5, Math.min(plateW / 2.5, off)), catchY + fruitR * 0.2, fruitR * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  drawCombo(v, comboAt(map, t), W / 2, H * 0.28, Math.min(W, H) * 0.08);
}

/* ---------- mania ---------- */

export function drawMania(v: ModeView, map: OsuMap, t: number, rate: number): void {
  const { ctx, width: W, height: H } = v;
  ctx.clearRect(0, 0, W, H);
  const keys = Math.max(1, Math.min(18, Math.round(map.cs) || 4));
  const colW = Math.min((W * 0.86) / keys, H * 0.11);
  const left = (W - colW * keys) / 2;
  const hitY = H * 0.88;
  // Scroll: notes take ~650 ms (at 1x) to fall to the keys.
  const fall = 650 * rate;
  const column = (o: HitObject) => Math.max(0, Math.min(keys - 1, Math.floor((o.x * keys) / 512)));
  const colour = (c: number) => {
    const mid = (keys - 1) / 2;
    if (keys % 2 === 1 && c === mid) return "#f2c94c";
    return (c < mid ? c : keys - 1 - c) % 2 === 0 ? "#ffffff" : PINK;
  };

  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(left, 0, colW * keys, H);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = v.dpr;
  for (let c = 0; c <= keys; c++) {
    ctx.beginPath();
    ctx.moveTo(left + c * colW, 0);
    ctx.lineTo(left + c * colW, H);
    ctx.stroke();
  }

  const pressed = new Array<number>(keys).fill(0);
  const noteH = Math.max(6, colW * 0.32);
  for (const o of map.objects) {
    if (o.time - fall > t) break;
    const c = column(o);
    if (o.kind === "hold") {
      if (o.endTime < t) continue;
      if (o.time <= t) pressed[c] = 1;
      const yHead = o.time <= t ? hitY : hitY - ((o.time - t) / fall) * hitY;
      const yTail = hitY - ((o.endTime - t) / fall) * hitY;
      ctx.fillStyle = colour(c);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(left + c * colW + colW * 0.18, Math.max(0, yTail), colW * 0.64, yHead - Math.max(0, yTail));
      ctx.globalAlpha = 1;
      ctx.fillRect(left + c * colW + 3, yHead - noteH, colW - 6, noteH);
      continue;
    }
    if (o.time < t) {
      if (t - o.time < 90) pressed[c] = Math.max(pressed[c], 1 - (t - o.time) / 90);
      continue;
    }
    const y = hitY - ((o.time - t) / fall) * hitY;
    ctx.fillStyle = colour(c);
    ctx.fillRect(left + c * colW + 3, y - noteH, colW - 6, noteH);
  }

  // Keys.
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(left, hitY, colW * keys, Math.max(2, v.dpr * 2));
  for (let c = 0; c < keys; c++) {
    const x = left + c * colW;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x + 3, hitY + 6, colW - 6, H - hitY - 10);
    if (pressed[c] > 0) {
      const g = ctx.createLinearGradient(0, hitY, 0, hitY - H * 0.3);
      g.addColorStop(0, `rgba(255,102,170,${0.55 * pressed[c]})`);
      g.addColorStop(1, "rgba(255,102,170,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, hitY - H * 0.3, colW, H * 0.3);
      ctx.fillStyle = `rgba(255,255,255,${0.7 * pressed[c]})`;
      ctx.fillRect(x + 3, hitY + 6, colW - 6, H - hitY - 10);
    }
  }
  drawCombo(v, comboAt(map, t), W / 2, H * 0.3, Math.min(W, H) * 0.06);
}
