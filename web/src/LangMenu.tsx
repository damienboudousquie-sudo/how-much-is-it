import { useEffect, useRef, useState } from "react";
import { trackEvent } from "./track";
import { LANGS, type Lang } from "@osu-pp/shared";
import { useI18n } from "./i18n";

/** Each language in its own words, so anyone can find theirs. */
const NAMES: Record<Lang, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  de: "Deutsch",
  pt: "Português",
  pl: "Polski",
  ru: "Русский",
  ko: "한국어",
  ja: "日本語",
  zh: "中文",
};

/** Small dropdown to pick the site language. */
export function LangMenu() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lang-menu" ref={box}>
      <button type="button" className="lang-current" aria-haspopup="menu" aria-expanded={open} aria-label="Language" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
        <span>{lang.toUpperCase()}</span>
        <span className="account-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="lang-list" role="menu">
          {LANGS.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={lang === code}
              lang={code}
              onClick={() => {
                setLang(code);
                trackEvent("lang_change");
                setOpen(false);
              }}
            >
              <span>{NAMES[code]}</span>
              <span className="lang-code">{code.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
