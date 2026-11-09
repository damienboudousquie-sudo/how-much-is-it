import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/** A clean volume control: speaker icon (click to mute) and a thin bar you drag or click. */
export function VolumeSlider(props: { value: number; onChange: (value: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [before, setBefore] = useState(0.6);
  const value = Math.max(0, Math.min(1, props.value));

  const setFrom = (x: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect) return;
    props.onChange(Math.round(Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * 100) / 100);
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setFrom(event.clientX);
    const move = (e: PointerEvent) => setFrom(e.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };

  const toggleMute = () => {
    if (value > 0) {
      setBefore(value);
      props.onChange(0);
    } else props.onChange(before || 0.6);
  };

  return (
    <div className="volume">
      <button type="button" className="volume-icon" aria-label="Volume" onClick={toggleMute}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z" fill="currentColor" />
          {value > 0 && <path d="M15 9.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
          {value > 0.5 && <path d="M17.5 7a7 7 0 0 1 0 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
          {value === 0 && <path d="M15.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
      </button>
      <div
        className="volume-track"
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
        onPointerDown={down}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") props.onChange(Math.min(1, value + 0.05));
          if (event.key === "ArrowLeft" || event.key === "ArrowDown") props.onChange(Math.max(0, value - 0.05));
        }}
      >
        <div className="volume-fill" style={{ width: `${value * 100}%` }} />
        <div className="volume-knob" style={{ left: `${value * 100}%` }} />
      </div>
    </div>
  );
}
