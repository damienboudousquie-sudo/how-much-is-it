import { useEffect, useRef, useState } from "react";
import type { DiscoverHit, MapStyle, RecommendResponse } from "@osu-pp/shared";
import { useAccount } from "./account";
import { MapCard } from "./Finder";
import { formatPp } from "./format";
import { currentLang, fill, useI18n } from "./i18n";

const pct = (share: number) => `${Math.round(share * 100)} %`;

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
        // Show the pp the player would really get, not the SS pp.
        setData({ ...answer, results: answer.results.map((hit) => ({ ...hit, pp: Math.round(hit.pp * answer.ratio) })) });
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
        <h2>{t.forYou}</h2>
        {signedIn && (
          <button type="button" className="button ghost small" disabled={loading} onClick={() => setRound((value) => value + 1)}>
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
          <a className="login-osu" href="/api/auth/login">
            {t.login}
          </a>
        )}
      </div>
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
