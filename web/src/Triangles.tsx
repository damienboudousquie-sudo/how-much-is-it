import { useEffect, useRef } from "react";

/**
 * osu!-style background: pink triangles rising slowly, bigger ones closer and fainter.
 * Draws at 40 fps at most, stops while the tab is hidden, and holds a still frame
 * when the system asks for reduced motion.
 */

const COLORS = ["255, 102, 170", "255, 143, 196", "214, 92, 255", "255, 74, 140"];
// 40 fps keeps the faster motion smooth while staying light.
const FRAME_MS = 1000 / 40;

interface Triangle {
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  phase: number;
  alpha: number;
  color: string;
  outline: boolean;
}

function spawn(width: number, height: number, anywhere: boolean): Triangle {
  const depth = Math.random();
  const size = 18 + depth * depth * 170;
  return {
    x: Math.random() * width,
    y: anywhere ? Math.random() * (height + size) : height + size,
    size,
    // Small triangles feel far away: slower and a little dimmer.
    speed: 22 + depth * 48 + Math.random() * 10,
    drift: 8 + Math.random() * 14,
    phase: Math.random() * Math.PI * 2,
    alpha: 0.06 + Math.random() * 0.12,
    color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
    outline: Math.random() < 0.35,
  };
}

function draw(ctx: CanvasRenderingContext2D, item: Triangle, x: number) {
  const half = item.size / 2;
  const height = item.size * 0.866;
  const top = item.y - height / 2;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x + half, top + height);
  ctx.lineTo(x - half, top + height);
  ctx.closePath();
  if (item.outline) {
    ctx.strokeStyle = `rgba(${item.color}, ${Math.min(0.7, item.alpha * 2.6)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    const gradient = ctx.createLinearGradient(0, top, 0, top + height);
    gradient.addColorStop(0, `rgba(${item.color}, ${Math.min(0.55, item.alpha * 2.1)})`);
    gradient.addColorStop(1, `rgba(${item.color}, ${item.alpha * 0.2})`);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

export function Triangles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let items: Triangle[] = [];
    let frame = 0;
    let last = 0;

    const render = (time: number) => {
      ctx.clearRect(0, 0, width, height);
      for (const item of items) draw(ctx, item, item.x + Math.sin(time / 2500 + item.phase) * item.drift);
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(60, Math.round((width * height) / 26000));
      while (items.length < count) items.push(spawn(width, height, true));
      items = items.slice(0, count);
      render(performance.now());
    };

    const tick = (time: number) => {
      frame = window.requestAnimationFrame(tick);
      if (time - last < FRAME_MS) return;
      const step = Math.min(0.1, (time - (last || time)) / 1000);
      last = time;
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        item.y -= item.speed * step;
        if (item.y < -item.size) items[index] = spawn(width, height, false);
      }
      render(time);
    };

    const start = () => {
      if (reduced || frame) return;
      last = 0;
      frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    resize();
    start();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="triangles" aria-hidden="true" />;
}
