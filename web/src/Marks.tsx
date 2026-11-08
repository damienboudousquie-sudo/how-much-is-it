import type { MouseEvent } from "react";
import type { MapMark } from "@osu-pp/shared";
import { useAccount } from "./account";
import { formatPp } from "./format";
import { fill, useI18n } from "./i18n";

/** Buttons that live inside a link card: they must not open the map. */
function hold(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/** "To farm" and "done" toggles for one map. */
export function MarkButtons(props: { beatmapId: number; large?: boolean }) {
  const { t } = useI18n();
  const account = useAccount();
  const mark = account.markOf(props.beatmapId);
  const toggle = (value: MapMark) => (event: MouseEvent) => {
    hold(event);
    account.setMark(props.beatmapId, mark === value ? null : value);
  };
  return (
    <span className={`marks${props.large ? " large" : ""}`} role="group" aria-label={t.marks}>
      <button
        type="button"
        className={`mark-btn farm${mark === "farm" ? " on" : ""}`}
        aria-pressed={mark === "farm"}
        title={mark === "farm" ? t.markClear : t.markFarm}
        onClick={toggle("farm")}
      >
        <span className="mark-dot" aria-hidden="true" />
        {props.large ? t.markFarm : null}
      </button>
      <button
        type="button"
        className={`mark-btn done${mark === "done" ? " on" : ""}`}
        aria-pressed={mark === "done"}
        title={mark === "done" ? t.markClear : t.markDone}
        onClick={toggle("done")}
      >
        <span className="mark-dot" aria-hidden="true" />
        {props.large ? t.markDone : null}
      </button>
    </span>
  );
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

/** Sign in with osu!, or the signed-in player. */
export function AccountButton() {
  const { t } = useI18n();
  const account = useAccount();
  if (!account.ready) return null;
  if (account.profile) {
    const profile = account.profile;
    return (
      <div className="account">
        <a className="account-who" href={`https://osu.ppy.sh/users/${profile.id}`} target="_blank" rel="noreferrer" title={t.profileHelp}>
          {profile.avatarUrl && <img src={profile.avatarUrl} alt="" width={26} height={26} />}
          <span className="account-name">{profile.username}</span>
          {profile.pp != null && <span className="account-pp">{formatPp(profile.pp)} pp</span>}
        </a>
        <button type="button" className="account-out" onClick={account.logout}>
          {t.logout}
        </button>
      </div>
    );
  }
  if (!account.loginAvailable) return null;
  return (
    <a className="login-osu" href="/api/auth/login">
      {t.login}
    </a>
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
