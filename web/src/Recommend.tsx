import { useEffect, useRef, useState } from "react";
import { trackEvent } from "./track";
import type { DiscoverHit, MapStyle, RecommendResponse } from "@osu-pp/shared";
import { useAccount } from "./account";
import { MapCard } from "./Finder";
import { formatPp } from "./format";
import { currentLang, fill, useI18n } from "./i18n";

const pct = (share: number) => `${Math.round(share * 100)} %`;

/**
 * Rank brackets drawn in the osu! tier colours (iron to lustrous, the colours osu! uses
 * for its tiers), from the top 100 down.
 */
const TIERS: { max: number; name: string }[] = [
  { max: 100, name: "lustrous" },
  { max: 1000, name: "radiant" },
  { max: 5000, name: "rhodium" },
  { max: 10000, name: "platinum" },
  { max: 50000, name: "gold" },
  { max: 100000, name: "silver" },
  { max: 500000, name: "bronze" },
  { max: Infinity, name: "iron" },
];

function tierOf(rank: number | null): string {
  if (rank == null || rank <= 0) return "iron";
  return TIERS.find((tier) => rank <= tier.max)!.name;
}

/** The signed-in player as a small osu!-style card: avatar, name, flag, ranks and pp. */
function PlayerCard() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const profile = account.profile;
  if (!profile) return null;
  const country = profile.country?.toUpperCase() ?? null;
  let countryName = country ?? "";
  try {
    if (country) countryName = new Intl.DisplayNames([lang], { type: "region" }).of(country) ?? country;
  } catch {
    // Keep the code.
  }
  const number = (value: number) => value.toLocaleString(lang);
  return (
    <a className="player-card" href={`https://osu.ppy.sh/users/${profile.id}`} target="_blank" rel="noreferrer">
      {profile.avatarUrl && <img className="player-avatar" src={profile.avatarUrl} alt="" width={64} height={64} />}
      <span className="player-main">
        <span className="player-name">{profile.username}</span>
        {country && (
          <span className="player-country">
            <img src={`https://flagcdn.com/w40/${country.toLowerCase()}.png`} alt="" width={20} height={15} />
            {countryName}
          </span>
        )}
      </span>
      <span className="player-figures">
        <span className={`player-rank tier-${tierOf(profile.rank)}`} title={t.globalRank}>
          <small>{t.globalRank}</small>
          {profile.rank ? `#${number(profile.rank)}` : "—"}
        </span>
        {profile.countryRank != null && (
          <span className="player-figure" title={t.countryRank}>
            <small>{t.countryRank}</small>#{number(profile.countryRank)}
          </span>
        )}
        {profile.pp != null && (
          <span className="player-figure is-pp">
            <small>pp</small>
            {number(Math.round(profile.pp))}
          </span>
        )}
      </span>
    </a>
  );
}

/** Tillerino-style suggestions built from the signed-in player's top plays. */
export function ForYou(props: { onOpen(hit: DiscoverHit): void }) {
  const { t } = useI18n();
  const account = useAccount();
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [round, setRound] = useState(0);
  // Maps shown before a refresh, so the next list brings new ones.
  const shown = useRef<number[]>([]);
  const signedIn = account.profile != null;

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const skip = round > 0 ? `?skip=${shown.current.slice(-400).join(",")}` : "";
    fetch(`/api/recommend${skip}`, { headers: { "x-lang": currentLang() }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? response.statusText);
        }
        return (await response.json()) as RecommendResponse;
      })
      .then((answer) => {
        if (!alive) return;
        shown.current = [...shown.current, ...answer.results.map((hit) => hit.beatmapId)];
        // Cards show the FC pp (the range is in FC pp); the gain uses what the player would really get.
        setData({ ...answer, results: answer.results.map((hit) => ({ ...hit, expectedPp: Math.round(hit.pp * answer.ratio) })) });
      })
      .catch((failure) => alive && setError(failure instanceof Error ? failure.message : String(failure)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [signedIn, round, account.top.length]);

  if (!account.ready) return null;

  return (
    <section className="finder pinned for-you">
      <div className="panel pinned-head for-you-head">
        <h2>
          {t.forYou}
          <span className="beta-badge">{t.experimental}</span>
        </h2>
        {signedIn && (
          <button type="button" className="button ghost small" disabled={loading} onClick={() => {
              trackEvent("foryou_refresh");
              setRound((value) => value + 1);
            }}>
            {t.forYouRefresh}
          </button>
        )}
        <p className="help">{signedIn ? t.forYouIntro : t.forYouSignIn}</p>
        {data && data.results.length > 0 && (
          <dl className="for-you-profile">
            <div>
              <dt>{t.forYouRange}</dt>
              <dd>
                {formatPp(data.ppMin)}–{formatPp(data.ppMax)} pp
              </dd>
            </div>
            <div>
              <dt>{t.forYouLevel}</dt>
              <dd>{fill(t.forYouRatio, { pct: pct(data.ratio) })}</dd>
            </div>
            <div title={t.forYouCalHelp}>
              <dt>{t.forYouCal}</dt>
              <dd>{(data.calibration ?? 1) === 1 ? t.forYouCalSame : fill(t.forYouCalAdjusted, { x: (data.calibration ?? 1).toFixed(2) })}</dd>
            </div>
            <div>
              <dt>{t.forYouMods}</dt>
              <dd>{data.mods.map((item) => `${item.mods.join("") || t.nm} ${pct(item.share)}`).join(" · ")}</dd>
            </div>
            {data.styles.length > 0 && (
              <div>
                <dt>{t.forYouTypes}</dt>
                <dd>
                  {data.styles
                    .slice(0, 3)
                    .map((item) => `${t.styles[item.style as MapStyle] ?? item.style} ${pct(item.share)}`)
                    .join(" · ")}
                </dd>
              </div>
            )}
            {data.wanted.length > 0 && (
              <div>
                <dt>{t.forYouShown}</dt>
                <dd>{data.wanted.map((style) => t.styles[style as MapStyle] ?? style).join(" · ")}</dd>
              </div>
            )}
          </dl>
        )}
        {!signedIn && (
          <a className="login-osu" href="/api/auth/login" onClick={() => trackEvent("login_click")}>
            {t.login}
          </a>
        )}
      </div>
      <PlayerCard />
      {error && <p className="notice error">{error}</p>}
      {loading && !data && <p className="empty">{t.forYouLoading}</p>}
      {data && data.results.length === 0 && !loading && <p className="empty">{t.forYouEmpty}</p>}
      {data && data.results.length > 0 && (
        <div className="map-list">
          {data.results.map((hit, index) => (
            <MapCard key={`${hit.beatmapId}:${hit.mods.join("")}`} hit={hit} rank={index + 1} showRank onOpen={props.onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}
