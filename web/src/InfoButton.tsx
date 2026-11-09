import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";

/** A small "?" in the top-right corner: how the pp are computed, on hover or tap. */
export function InfoButton() {
  const { t } = useI18n();
  const [pinned, setPinned] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setPinned(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setPinned(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [pinned]);

  return (
    <div className={pinned ? "info open" : "info"} ref={box}>
      <button type="button" className="info-button" aria-label={t.infoLabel} aria-expanded={pinned} onClick={() => setPinned((value) => !value)}>
        {/* Drawn, not typed: a "?" character sits differently in each font. */}
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M8.8 8.6a3.3 3.3 0 0 1 6.4 1.1c0 2.2-3.2 2.6-3.2 4.8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="18.6" r="1.45" fill="currentColor" />
        </svg>
      </button>
      <div className="info-card" role="tooltip">
        <p>{t.footer}</p>
        <p>{t.ppDisclaimer}</p>
      </div>
    </div>
  );
}
