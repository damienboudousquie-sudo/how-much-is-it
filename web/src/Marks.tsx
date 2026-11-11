import { useEffect, useRef, useState, type MouseEvent } from "react";
import { trackEvent } from "./track";
import { createPortal } from "react-dom";
import type { MapMark } from "@osu-pp/shared";
import { useAccount, type PinSource } from "./account";
import { formatPp } from "./format";
import { fill, useI18n } from "./i18n";

/** Buttons that live inside a link card: they must not open the map. */
function hold(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/** Push-pin icon. */
function PinIcon(props: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M14.5 2.8 21.2 9.5a1 1 0 0 1-.4 1.6l-3.1 1.1-3.3 3.3.4 3.7a1 1 0 0 1-1.7.8L9.3 16.2 4.4 21.1a.9.9 0 0 1-1.3-1.3L8 14.9 4.2 11.1a1 1 0 0 1 .8-1.7l3.7.4L12 6.5l1.1-3.1a1 1 0 0 1 1.4-.6Z"
        fill={props.filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A pin on each map. Clicking it opens a small menu: to farm, done, or unpin.
 * The menu is drawn on the page body, so the card's rounded clipping never cuts it.
 */
export function PinButton(props: { beatmapId: number; map: PinSource; large?: boolean }) {
  const { t } = useI18n();
  const account = useAccount();
  const mark = account.markOf(props.beatmapId);
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const open = (event: MouseEvent) => {
    hold(event);
    if (menu) return setMenu(null);
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 170;
    setMenu({ top: rect.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width)) });
  };
  const choose = (value: MapMark | null) => (event: MouseEvent) => {
    hold(event);
    account.setMark(props.beatmapId, value, props.map);
    trackEvent(value === "farm" ? "pin_farm" : value === "done" ? "pin_done" : "pin_clear");
    setMenu(null);
  };
  const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`pin-btn${mark ? ` pinned-${mark}` : ""}${props.large ? " large" : ""}`}
        aria-haspopup="menu"
        aria-expanded={menu != null}
        title={mark === "farm" ? t.markFarm : mark === "done" ? t.markDone : t.pin}
        onClick={open}
      >
        <PinIcon filled={mark != null} />
        {props.large ? (mark === "farm" ? t.markFarm : mark === "done" ? t.markDone : t.pin) : null}
      </button>
      {menu &&
        createPortal(
          <div className="pin-menu" role="menu" style={{ top: menu.top, left: menu.left }} onPointerDown={stop}>
            <button type="button" role="menuitemradio" aria-checked={mark === "farm"} className="is-farm" onClick={choose("farm")}>
              <span className="pin-swatch" aria-hidden="true" />
              {t.markFarm}
            </button>
            <button type="button" role="menuitemradio" aria-checked={mark === "done"} className="is-done" onClick={choose("done")}>
              <span className="pin-swatch" aria-hidden="true" />
              {t.markDone}
            </button>
            {mark && (
              <button type="button" role="menuitem" className="clear" onClick={choose(null)}>
                {t.markClear}
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** Card fields kept with a pin. */
export function pinSource(hit: {
  beatmapId: number;
  beatmapsetId: number | null;
  mode: PinSource["mode"];
  title: string;
  artist: string;
  version: string;
  creator: string;
  cover: string | null;
  stars: number;
  pp: number;
  mods: string[];
  lengthSeconds?: number | null;
  bpm?: number | null;
  ar?: number | null;
  style?: PinSource["style"];
  tags?: PinSource["tags"];
}): PinSource {
  return {
    beatmapId: hit.beatmapId,
    beatmapsetId: hit.beatmapsetId,
    mode: hit.mode,
    title: hit.title,
    artist: hit.artist,
    version: hit.version,
    creator: hit.creator,
    cover: hit.cover,
    stars: hit.stars,
    pp: hit.pp,
    mods: hit.mods,
    lengthSeconds: hit.lengthSeconds ?? null,
    bpm: hit.bpm ?? null,
    ar: hit.ar ?? null,
    style: hit.style ?? null,
    tags: hit.tags ?? [],
  };
}

/** The player's own score on this map, and what a full combo SS would add to their total. */
export function PlayerBadges(props: { beatmapId: number; pp: number }) {
  const { t } = useI18n();
  const account = useAccount();
  if (!account.profile) return null;
  const best = account.topById.get(props.beatmapId);
  const gain = account.gainFor(props.beatmapId, props.pp);
  return (
    <>
      {best && (
        <span className="tag top-play" title={fill(t.inTopHelp, { pp: formatPp(best.pp) })}>
          {fill(t.inTop, { pp: formatPp(best.pp) })}
        </span>
      )}
      {gain > 0 && (
        <span className="tag gain" title={t.gainHelp}>
          +{formatPp(gain)} pp
        </span>
      )}
    </>
  );
}

/** Sign in with osu!, or the signed-in player with a small menu. */
export function AccountButton(props: { onPinned(): void; onFeedback(): void; onForYou(): void; onStats(): void; onProfile(): void }) {
  const { t } = useI18n();
  const account = useAccount();
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

  if (!account.ready) return null;
  if (account.profile) {
    const profile = account.profile;
    const count = Object.keys(account.marks).length;
    return (
      <div className="account" ref={box}>
        <button type="button" className="account-who" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {profile.avatarUrl && <img src={profile.avatarUrl} alt="" width={26} height={26} />}
          <span className="account-name">{profile.username}</span>
          {profile.pp != null && <span className="account-pp">{formatPp(profile.pp)} pp</span>}
          <span className="account-caret" aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="account-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              className="is-profile"
              onClick={() => {
                setOpen(false);
                props.onProfile();
              }}
            >
              {t.myProfile}
              <span className="new-badge">{t.newBadge}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                props.onForYou();
              }}
            >
              {t.forYou}
              <span className="beta-badge">{t.experimental}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                props.onPinned();
              }}
            >
              {t.pinnedMaps}
              {count > 0 && <span className="count">{count}</span>}
            </button>
            {account.admin && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  props.onFeedback();
                }}
              >
                {t.feedbackInbox}
              </button>
            )}
            {account.admin && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  props.onStats();
                }}
              >
                {t.stats}
              </button>
            )}
            <a role="menuitem" href={`https://osu.ppy.sh/users/${profile.id}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
              {t.profileHelp} ↗
            </a>
            <button
              type="button"
              role="menuitem"
              className="out"
              onClick={() => {
                setOpen(false);
                account.logout();
              }}
            >
              {t.logout}
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="account">
      {Object.keys(account.marks).length > 0 && (
        <button type="button" className="account-out" onClick={props.onPinned}>
          {t.pinnedMaps}
        </button>
      )}
      {account.loginAvailable && (
        <a className="login-osu" href="/api/auth/login" title={t.loginSafe} onClick={() => trackEvent("login_click")}>
          <span className="login-full">{t.login}</span>
          <span className="login-short">{t.loginShort}</span>
        </a>
      )}
    </div>
  );
}

/** Shown once after a failed sign-in, with osu!'s reason. */
export function LoginError() {
  const { t } = useI18n();
  const account = useAccount();
  if (!account.loginError) return null;
  return (
    <p className="notice error" role="alert">
      {t.loginFailed} {account.loginError}{" "}
      <button type="button" className="link" onClick={account.dismissLoginError}>
        ×
      </button>
    </p>
  );
}
