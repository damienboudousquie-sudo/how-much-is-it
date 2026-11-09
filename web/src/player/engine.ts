import { pointAt, type HitObject, type OsuMap, type Point } from "./osuFile";
import { tinted, type Skin } from "./skin";

export interface PlayerMods {
  /** Clock rate: 1.5 for DT, 0.75 for HT. */
  rate: number;
  hr: boolean;
  ez: boolean;
  hd: boolean;
  /** Nightcore: the song speeds up with its pitch. DT and HT keep the pitch. */
  nc: boolean;
}

export interface PlayerStatus {
  time: number;
  start: number;
  duration: number;
  playing: boolean;
  music: boolean;
}

interface SoundEvent {
  time: number;
  bits: number;
  tick: boolean;
  set: string;
  volume: number;
}

const SETS: Record<number, string> = { 1: "normal", 2: "soft", 3: "drum" };
const HIT_FADE = 240;

const unit = (x: number, y: number): Point | null => {
  const l = Math.hypot(x, y);
  return l < 1e-6 ? null : { x: x / l, y: y / l };
};

/** Draws an osu!standard map on a canvas, played by auto, with the skin's sprites and hitsounds. */
export class AutoPlayer {
  time: number;
  playing = true;
  dance = true;
  hitsounds = true;
  private mods: PlayerMods = { rate: 1, hr: false, ez: false, hd: false, nc: false };
  private frame = 0;
  private last = performance.now();
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private radius = 32;
  private preempt = 1200;
  private fadeIn = 800;
  private sounds: SoundEvent[];
  private audio: AudioContext | null = null;
  private buffers: Record<string, AudioBuffer> = {};
  private music: HTMLAudioElement | null = null;
  private musicBase = 0;
  /** True when the music is the whole song, so map time is the song time. */
  private fullSong = false;
  private observer: ResizeObserver | null = null;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: OsuMap,
    private readonly skin: Skin,
    private readonly onStatus: (status: PlayerStatus) => void,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available.");
    this.ctx = ctx;
    this.time = map.start;
    this.sounds = this.soundEvents();
    this.applyMods();
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
    this.frame = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.stopMusic();
    void this.audio?.close().catch(() => undefined);
    this.audio = null;
  }

  setMods(mods: PlayerMods): void {
    this.mods = mods;
    if (this.music) {
      this.music.playbackRate = mods.rate;
      this.music.preservesPitch = !mods.nc;
    }
    this.applyMods();
  }

  /** Browsers only allow sound after a click: call this from one. */
  unlockAudio(): void {
    if (this.audio) {
      if (this.audio.state === "suspended") void this.audio.resume();
      return;
    }
    try {
      this.audio = new AudioContext();
    } catch {
      return;
    }
    for (const [name, data] of Object.entries(this.skin.sounds)) {
      this.audio
        .decodeAudioData(data.slice(0))
        .then((buffer) => {
          this.buffers[name] = buffer;
        })
        .catch(() => undefined);
    }
  }

  togglePlay(): void {
    this.playing = !this.playing;
    if (this.music) {
      if (this.playing) void this.music.play().catch(() => undefined);
      else this.music.pause();
    }
    this.report();
  }

  seek(fraction: number): void {
    this.time = this.map.start + Math.max(0, Math.min(1, fraction)) * (this.map.duration - this.map.start);
    if (this.music && this.fullSong) this.music.currentTime = Math.max(0, this.time / 1000);
    else this.stopMusic();
  }

  /**
   * Plays music under the map. The whole song keeps the map where it is; the 10 s osu!
   * preview clip jumps the map to where that clip starts.
   */
  async playMusic(url: string, fullSong: boolean): Promise<boolean> {
    this.stopMusic();
    const audio = new Audio(url);
    audio.preservesPitch = !this.mods.nc;
    audio.playbackRate = this.mods.rate;
    audio.volume = 0.5;
    this.fullSong = fullSong;
    if (fullSong) {
      this.musicBase = 0;
      audio.currentTime = Math.max(0, this.time / 1000);
    } else {
      this.musicBase = this.map.previewTime > 0 ? this.map.previewTime : this.map.start;
      this.time = this.musicBase;
    }
    try {
      await audio.play();
    } catch {
      return false;
    }
    audio.addEventListener("ended", () => {
      if (this.music !== audio) return;
      if (!fullSong) return this.stopMusic();
      // Loop the whole map, like the silent player does.
      this.time = this.map.start;
      audio.currentTime = Math.max(0, this.map.start / 1000);
      void audio.play().catch(() => undefined);
    });
    this.music = audio;
    this.playing = true;
    this.report();
    return true;
  }

  stopMusic(): void {
    if (!this.music) return;
    this.music.pause();
    this.music = null;
    this.report();
  }

  get hasMusic(): boolean {
    return this.music != null;
  }

  // ---------- timing ----------

  private tick = (now: number): void => {
    const dt = Math.min(100, now - this.last);
    this.last = now;
    if (this.playing) {
      const before = this.time;
      if (this.music && !this.music.paused) this.time = this.musicBase + this.music.currentTime * 1000;
      else this.time += dt * this.mods.rate;
      if (this.time > this.map.duration) {
        this.time = this.map.start;
        if (this.music && this.fullSong) this.music.currentTime = Math.max(0, this.map.start / 1000);
      } else this.playSounds(before, this.time);
    }
    this.draw();
    this.report();
    this.frame = requestAnimationFrame(this.tick);
  };

  private report(): void {
    this.onStatus({ time: this.time, start: this.map.start, duration: this.map.duration, playing: this.playing, music: this.music != null });
  }

  private applyMods(): void {
    const m = this.map;
    let cs = m.cs;
    let ar = m.ar;
    if (this.mods.hr) {
      cs = Math.min(10, cs * 1.3);
      ar = Math.min(10, ar * 1.4);
    }
    if (this.mods.ez) {
      cs *= 0.5;
      ar *= 0.5;
    }
    this.preempt = ar < 5 ? 1200 + (600 * (5 - ar)) / 5 : 1200 - (750 * (ar - 5)) / 5;
    this.fadeIn = ar < 5 ? 800 + (400 * (5 - ar)) / 5 : 800 - (500 * (ar - 5)) / 5;
    this.radius = 54.4 - 4.48 * cs;
    this.stack();
  }

  // ---------- hitsounds ----------

  private soundEvents(): SoundEvent[] {
    const map = this.map;
    const general = SETS[{ Normal: 1, Soft: 2, Drum: 3 }[map.sampleSet] ?? 1] ?? "normal";
    const out: SoundEvent[] = [];
    let index = 0;
    const objects = [...map.objects];
    const at = (time: number) => {
      let point = null;
      for (const p of map.timing) {
        if (p.time > time + 2) break;
        point = p;
      }
      return { set: (point && SETS[point.sampleSet]) || general, volume: point ? point.volume : 100 };
    };
    const push = (time: number, bits: number, tick = false) => out.push({ time, bits, tick, ...at(time) });
    for (const o of objects) {
      index += 1;
      if (o.kind === "circle") push(o.time, o.sound);
      else if (o.kind === "spinner") push(o.endTime, o.sound);
      else {
        for (let i = 0; i <= o.slides; i++) push(o.time + i * o.slideTime, o.edges ? (o.edges[i] ?? o.sound) : o.sound);
        if (o.tickDist > 0 && o.tickDist < o.length) {
          for (let s = 0; s < o.slides; s++) {
            for (let d = o.tickDist; d < o.length - 10; d += o.tickDist) {
              const f = s % 2 ? (o.length - d) / o.length : d / o.length;
              push(o.time + (s + f) * o.slideTime, 0, true);
            }
          }
        }
      }
    }
    return index > 0 ? out.sort((a, b) => a.time - b.time) : out;
  }

  private play(name: string, volume: number): void {
    const buffer = this.buffers[name];
    if (!buffer || !this.audio) return;
    const source = this.audio.createBufferSource();
    const gain = this.audio.createGain();
    gain.gain.value = (volume / 100) * 0.5;
    source.buffer = buffer;
    source.connect(gain).connect(this.audio.destination);
    source.start();
  }

  private playSounds(from: number, to: number): void {
    if (!this.hitsounds || !this.audio || to <= from || to - from > 250) return;
    const events = this.sounds;
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].time <= from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < events.length && events[i].time <= to; i++) {
      const e = events[i];
      if (e.tick) {
        this.play(`${e.set}-slidertick`, e.volume);
        continue;
      }
      this.play(`${e.set}-hitnormal`, e.volume);
      if (e.bits & 2) this.play(`${e.set}-hitwhistle`, e.volume);
      if (e.bits & 4) this.play(`${e.set}-hitfinish`, e.volume);
      if (e.bits & 8) this.play(`${e.set}-hitclap`, e.volume);
    }
  }

  // ---------- positions ----------

  /** Simplified osu!stable stacking: notes on the same spot shift up-left. */
  private stack(): void {
    const objs = this.map.objects;
    for (const o of objs) o.stack = 0;
    const window = this.preempt * this.map.stackLeniency;
    for (let i = objs.length - 1; i > 0; i--) {
      const a = objs[i];
      if (a.kind === "spinner") continue;
      for (let j = i - 1; j >= 0; j--) {
        const b = objs[j];
        if (b.kind === "spinner") continue;
        if (a.time - b.endTime > window) break;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 3) {
          b.stack = a.stack + 1;
          break;
        }
      }
    }
  }

  private offset(o: HitObject): number {
    return (o.stack * this.radius) / 10;
  }

  private objectPos(o: HitObject, t: number): Point {
    const off = this.offset(o);
    if (o.kind === "slider" && t >= o.time) {
      const e = Math.min(t, o.endTime) - o.time;
      const slide = Math.min(o.slides - 1, Math.floor(e / (o.slideTime || 1)));
      let f = (e - slide * o.slideTime) / (o.slideTime || 1);
      if (slide % 2 === 1) f = 1 - f;
      const p = pointAt(o, f * o.length);
      return { x: p.x - off, y: p.y - off };
    }
    if (o.kind === "spinner" && t >= o.time) {
      const a = (t - o.time) / 30;
      const r = 55 * Math.min(1, (t - o.time) / 200);
      return { x: 256 + r * Math.cos(a), y: 192 + r * Math.sin(a) };
    }
    return { x: o.x - off, y: o.y - off };
  }

  private endPos(o: HitObject): Point {
    if (o.kind === "slider") {
      const p = pointAt(o, o.slides % 2 ? o.length : 0);
      const off = this.offset(o);
      return { x: p.x - off, y: p.y - off };
    }
    if (o.kind === "spinner") return this.objectPos(o, o.endTime);
    return this.startPos(o);
  }

  private startPos(o: HitObject): Point {
    if (o.kind === "spinner") return { x: 256, y: 192 };
    const off = this.offset(o);
    return { x: o.x - off, y: o.y - off };
  }

  /**
   * Danser-style "momentum" move: leave each note in the direction the cursor was already
   * going and arrive heading towards the note after, so the path flows.
   */
  private curve(from: Point, to: Point, before: Point, after: Point, k: number): Point {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const d = Math.hypot(dx, dy);
    if (!this.dance || d < 2) return { x: from.x + dx * k, y: from.y + dy * k };
    const dirIn = unit(from.x - before.x, from.y - before.y) ?? unit(dx, dy)!;
    const dirOut = unit(after.x - to.x, after.y - to.y) ?? unit(dx, dy)!;
    const reach = Math.min(d * 0.32, 140);
    const c1 = { x: from.x + dirIn.x * reach, y: from.y + dirIn.y * reach };
    const c2 = { x: to.x - dirOut.x * reach, y: to.y - dirOut.y * reach };
    const u = 1 - k;
    return {
      x: u * u * u * from.x + 3 * u * u * k * c1.x + 3 * u * k * k * c2.x + k * k * k * to.x,
      y: u * u * u * from.y + 3 * u * u * k * c1.y + 3 * u * k * k * c2.y + k * k * k * to.y,
    };
  }

  private cursorAt(t: number): Point {
    const objs = this.map.objects;
    let lo = 0;
    let hi = objs.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (objs[mid].time <= t) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (idx < 0) return objs[0] ? this.startPos(objs[0]) : { x: 256, y: 192 };
    const o = objs[idx];
    if (t <= o.endTime) return this.objectPos(o, t);
    const next = objs[idx + 1];
    const from = this.endPos(o);
    if (!next) return from;
    const gap = next.time - o.endTime;
    const start = Math.max(o.endTime, next.time - Math.max(120, Math.min(gap, 600)));
    if (t < start) return from;
    let k = (t - start) / (next.time - start || 1);
    k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const before = o.kind === "slider" ? this.objectPos(o, o.endTime - 12) : idx > 0 ? this.endPos(objs[idx - 1]) : from;
    const after = next.kind === "slider" ? this.objectPos(next, next.time + 12) : objs[idx + 2] ? this.startPos(objs[idx + 2]) : this.startPos(next);
    return this.curve(from, this.startPos(next), before, after, k);
  }

  // ---------- drawing ----------

  private resize(): void {
    const box = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.round(box.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(box.height * this.dpr));
    const s = Math.min(box.width / 640, box.height / 480);
    this.scale = s * this.dpr;
    this.ox = (this.canvas.width - 512 * this.scale) / 2;
    this.oy = (this.canvas.height - 384 * this.scale) / 2 + 8 * this.scale;
  }

  private X(x: number): number {
    return this.ox + x * this.scale;
  }

  private Y(y: number): number {
    return this.oy + (this.mods.hr ? 384 - y : y) * this.scale;
  }

  private sprite(image: CanvasImageSource | undefined, x: number, y: number, k: number, alpha = 1, rotation = 0): void {
    if (!image || alpha <= 0) return;
    const source = image as HTMLImageElement;
    const w = source.width * k * this.scale;
    const h = source.height * k * this.scale;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.translate(this.X(x), this.Y(y));
    if (rotation) ctx.rotate(rotation);
    ctx.drawImage(image, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  private colour(o: HitObject): string {
    const list = this.skin.colours;
    return list[((o.colour % list.length) + list.length) % list.length];
  }

  private drawNumber(n: number, x: number, y: number, alpha: number): void {
    const images = this.skin.images;
    const digits = String(n)
      .split("")
      .map((d) => images[`default-${d}`])
      .filter(Boolean);
    if (digits.length === 0) return;
    const k = (this.radius / 64) * 0.8;
    const overlap = this.skin.hitCircleOverlap * k;
    const widths = digits.map((d) => d.width * k);
    const total = widths.reduce((a, b) => a + b, 0) - overlap * (digits.length - 1);
    let cx = x - total / 2;
    digits.forEach((d, i) => {
      this.sprite(d, cx + widths[i] / 2, y, k, alpha);
      cx += widths[i] - overlap;
    });
  }

  private drawHitCircle(o: HitObject, p: Point, alpha: number, slider: boolean, grow = 1, number = true): void {
    const k = (this.radius / 64) * grow;
    const images = this.skin.images;
    this.sprite(tinted(this.skin, "hitcircle", this.colour(o)), p.x, p.y, k, alpha);
    if (number) this.drawNumber(o.combo, p.x, p.y, alpha);
    this.sprite(slider && images.sliderstartcircleoverlay ? images.sliderstartcircleoverlay : images.hitcircleoverlay, p.x, p.y, k, alpha);
  }

  private drawSliderBody(o: HitObject, alpha: number): void {
    const ctx = this.ctx;
    const off = this.offset(o);
    const width = this.radius * 2 * this.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    o.path.forEach((p, i) => (i ? ctx.lineTo(this.X(p.x - off), this.Y(p.y - off)) : ctx.moveTo(this.X(p.x - off), this.Y(p.y - off))));
    ctx.strokeStyle = this.skin.sliderBorder;
    ctx.lineWidth = width * 0.97;
    ctx.stroke();
    ctx.strokeStyle = this.skin.sliderTrack;
    ctx.lineWidth = width * 0.84;
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.35;
    ctx.strokeStyle = "rgb(48,48,56)";
    ctx.lineWidth = width * 0.45;
    ctx.stroke();
    ctx.restore();
  }

  private drawTicks(o: HitObject, t: number, alpha: number): void {
    const tick = this.skin.images.sliderscorepoint;
    if (!tick || o.tickDist <= 0 || o.tickDist >= o.length) return;
    if (t >= o.time && Math.floor((t - o.time) / o.slideTime) % 2 === 1) return;
    const ball = t < o.time ? -1 : (((Math.min(t, o.endTime) - o.time) / o.slideTime) % 1) * o.length;
    const off = this.offset(o);
    for (let d = o.tickDist; d < o.length - 10; d += o.tickDist) {
      if (d <= ball) continue;
      const p = pointAt(o, d);
      this.sprite(tick, p.x - off, p.y - off, (this.radius / 64) * 0.8, alpha);
    }
  }

  /** Opacity of a note: fades in, and with HD fades out before it is hit. */
  private opacity(o: HitObject, t: number): number {
    const appear = o.time - this.preempt;
    if (this.mods.hd) {
      const fadeIn = this.preempt * 0.4;
      const inAlpha = Math.min(1, (t - appear) / fadeIn);
      const outStart = appear + fadeIn;
      const outAlpha = 1 - Math.min(1, Math.max(0, (t - outStart) / (this.preempt * 0.3)));
      return Math.max(0, Math.min(inAlpha, o.kind === "slider" && t > o.time ? 1 : outAlpha));
    }
    const inAlpha = Math.min(1, (t - appear) / this.fadeIn);
    const out = t > o.endTime ? 1 - (t - o.endTime) / HIT_FADE : 1;
    return Math.max(0, Math.min(inAlpha, out));
  }

  private draw(): void {
    const ctx = this.ctx;
    const t = this.time;
    const images = this.skin.images;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const objs = this.map.objects;
    const visible: HitObject[] = [];
    let combo = 0;
    for (const o of objs) {
      if (o.time <= t) combo += 1;
      if (o.time - this.preempt > t) break;
      if (o.endTime + HIT_FADE < t) continue;
      visible.push(o);
    }

    for (let i = visible.length - 1; i >= 0; i--) {
      const o = visible[i];
      const alpha = this.opacity(o, t);
      const p = this.startPos(o);
      if (o.kind === "spinner") {
        if (t > o.endTime) continue;
        const k = Math.max(0, Math.min(1, (t - o.time) / (o.endTime - o.time || 1)));
        const size = 384 / 1.1 / (images["spinner-circle"]?.width || 689);
        const a = t > o.time ? (t - o.time) / 90 : 0;
        const fade = Math.min(1, (t - (o.time - this.preempt)) / this.fadeIn);
        this.sprite(images["spinner-glow"], 256, 192, size, fade * 0.35 * k);
        this.sprite(images["spinner-background"], 256, 192, size, fade * 0.8);
        this.sprite(images["spinner-circle"], 256, 192, size, fade, a);
        this.sprite(images["spinner-approachcircle"], 256, 192, size * 1.7 * (1 - k) + 0.01, fade);
        continue;
      }
      if (o.kind === "slider") {
        const bodyAlpha = this.mods.hd && t > o.time ? Math.max(0, 1 - (t - o.time) / (o.endTime - o.time || 1)) : alpha;
        this.drawSliderBody(o, bodyAlpha * 0.9);
        this.drawTicks(o, t, bodyAlpha);
        if (o.slides > 1 && t < o.endTime) {
          const done = Math.max(0, Math.floor((t - o.time) / o.slideTime));
          if (done < o.slides - 1) {
            const atEnd = done % 2 === 0;
            const e = pointAt(o, atEnd ? o.length : 0);
            const q = pointAt(o, atEnd ? o.length - 6 : 6);
            const flip = this.mods.hr ? -1 : 1;
            const angle = Math.atan2((q.y - e.y) * flip, q.x - e.x);
            const pulse = 1 + 0.1 * Math.max(0, 1 - ((t % o.beat) / o.beat) * 2);
            const off = this.offset(o);
            this.sprite(images["reversearrow@2x"], e.x - off, e.y - off, (this.radius / 64) * 0.5 * pulse, bodyAlpha, angle);
          }
        }
        if (t < o.time) this.drawHitCircle(o, p, alpha, true);
        else if (t <= o.endTime) {
          const b = this.objectPos(o, t);
          const grow = Math.min(1, (t - o.time) / 120);
          this.sprite(images["sliderfollowcircle@2x"], b.x, b.y, (this.radius / 64) * 0.5 * (0.6 + 0.4 * grow), grow);
          this.sprite(tinted(this.skin, "sliderb0@2x", this.colour(o)), b.x, b.y, (this.radius / 64) * 0.5, 1);
          if (!this.mods.hd && t < o.time + HIT_FADE) {
            const k = (t - o.time) / HIT_FADE;
            this.drawHitCircle(o, p, 1 - k, false, 1 + 0.4 * k, false);
          }
        }
      } else if (t <= o.time) {
        this.drawHitCircle(o, p, alpha, false);
      } else if (!this.mods.hd) {
        const k = (t - o.time) / HIT_FADE;
        this.drawHitCircle(o, p, 1 - k, false, 1 + 0.4 * k, false);
      }
      if (t < o.time && !this.mods.hd) {
        const k = (o.time - t) / this.preempt;
        this.sprite(tinted(this.skin, "approachcircle", this.colour(o)), p.x, p.y, (this.radius / 64) * (1 + 3 * k), Math.min(1, alpha * 1.2));
      }
    }

    this.drawCursor(t);
    this.drawCombo(combo);
  }

  private drawCursor(t: number): void {
    const images = this.skin.images;
    const step = 4 * this.mods.rate;
    const points: Point[] = [];
    for (let back = 0; back <= 110 * this.mods.rate; back += step) points.push(this.cursorAt(t - back));
    const trail = images.cursortrail;
    for (let i = points.length - 1; i >= 1; i--) {
      const a = points[i];
      const b = points[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2.2));
      for (let j = 0; j < n; j++) {
        const k = j / n;
        const life = 1 - (i - k) / points.length;
        this.sprite(trail, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 0.62, life * 0.9);
      }
    }
    this.sprite(images.cursor, points[0].x, points[0].y, 0.62, 1);
  }

  private drawCombo(n: number): void {
    const images = this.skin.images;
    const digits = String(n)
      .split("")
      .map((d) => images[`berlin-${d}`]);
    if (images["score-x"]) digits.push(images["score-x"]);
    const h = 30 * this.dpr;
    let x = 12 * this.dpr;
    const y = this.canvas.height - h - 10 * this.dpr;
    for (const d of digits) {
      if (!d) continue;
      const w = (d.width / d.height) * h;
      this.ctx.drawImage(d, x, y, w, h);
      x += w - 2 * this.dpr;
    }
  }
}
