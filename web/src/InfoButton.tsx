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
        ?
      </button>
      <div className="info-card" role="tooltip">
        <p>{t.footer}</p>
        <p>{t.ppDisclaimer}</p>
      </div>
    </div>
  );
}
