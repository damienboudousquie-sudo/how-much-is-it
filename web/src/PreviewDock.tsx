import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { seekPreview, setPreviewVolume, stopPreview, togglePreview, usePreview } from "./audioPreview";
import { useI18n } from "./i18n";

const fmt = (s: number) => {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Small player in the bottom-right corner while a preview plays, like on the osu! website. */
export function PreviewDock() {
  const { t } = useI18n();
  const preview = usePreview();
  const bar = useRef<HTMLDivElement>(null);
  if (preview.setId == null) return null;
  const setId = preview.setId;
  const progress = preview.duration ? Math.min(1, preview.time / preview.duration) : 0;

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box) return;
    const at = (x: number) => seekPreview((x - box.left) / box.width);
    at(event.clientX);
    const move = (e: PointerEvent) => at(e.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };

  return (
    <div className="preview-dock" role="region" aria-label={t.previewPlay}>
      {preview.info?.cover && <img className="preview-cover" src={preview.info.cover} alt="" />}
      <div className="preview-body">
        <div className="preview-top">
          <button
            type="button"
            className="preview-toggle"
            aria-label={preview.playing ? t.playerPause : t.playerPlay}
            onClick={() => togglePreview(setId, preview.info)}
          >
            {preview.playing ? (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
                <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
              </svg>
            )}
          </button>
          <div className="preview-text">
            <span className="preview-title">{preview.info?.title ?? `#${setId}`}</span>
            {preview.info?.artist && <span className="preview-artist">{preview.info.artist}</span>}
          </div>
          <button type="button" className="preview-close" aria-label={t.previewStop} onClick={stopPreview}>
            ×
          </button>
        </div>
        <div className="preview-line">
          <span className="preview-time">{fmt(preview.time)}</span>
          <div className="preview-bar" ref={bar} onPointerDown={seek}>
            <div className="preview-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="preview-time">{fmt(preview.duration)}</span>
          <label className="preview-volume" title={t.playerMusic}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
              {preview.volume > 0 && <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={preview.volume}
              aria-label="Volume"
              onChange={(event) => setPreviewVolume(Number(event.currentTarget.value))}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
