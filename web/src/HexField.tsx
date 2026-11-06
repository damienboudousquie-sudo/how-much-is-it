import { useEffect, useRef } from "react";

const GAP = 118;

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rotation: number,
  tilt: number,
  alpha: number,
) {
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const angle = rotation + (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius * tilt;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = `rgba(255, 106, 168, ${alpha})`;
  ctx.stroke();
}

export function HexField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let frame = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time: number) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      ctx.clearRect(0, 0, width, height);
      ctx.lineWidth = 1;
      const cols = Math.ceil(width / GAP) + 2;
      const rows = Math.ceil(height / (GAP * 0.86)) + 2;

      for (const layer of [0, 1]) {
        const far = layer === 0;
        for (let row = -1; row < rows; row++) {
          for (let col = -1; col < cols; col++) {
            const stagger = (row & 1) * (GAP / 2);
            const cx = col * GAP + stagger + (far ? GAP * 0.35 : 0);
            const cy = row * GAP * 0.86 + (far ? 28 : 0);
            const phase = col * 0.85 + row * 0.55 + layer * 2.1;
            const depth = 0.5 + 0.5 * Math.sin(time * 0.00032 + phase);
            const toward = 0.55 + (cy / Math.max(height, 1)) * 0.6;
            const scale = (far ? 0.42 : 0.72) * toward * (0.62 + depth * 0.7);
            const tilt = 0.34 + depth * 0.66;
            const alpha = (far ? 0.1 : 0.16) + depth * (far ? 0.16 : 0.38);
            const direction = (col + row + layer) % 2 === 0 ? 1 : -1;
            const spin = time * (far ? 0.00018 : 0.00034) * direction + phase;
            drawTriangle(ctx, cx, cy, 34 * scale, spin, tilt, alpha);
          }
        }
      }
    };

    const tick = (time: number) => {
      draw(time);
      if (!reduced) frame = window.requestAnimationFrame(tick);
    };

    resize();
    frame = window.requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="hex-field" aria-hidden="true" />;
}
