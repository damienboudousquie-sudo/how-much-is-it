import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StatsResponse } from "@osu-pp/shared";
import { useAccount } from "./account";
import { currentLang, useI18n } from "./i18n";

let sentFirst = false;

/** Counts a page view (no cookie, no personal data; see server/src/stats.ts). */
export function trackView(path: string): void {
  try {
    const body = JSON.stringify({ path, ref: sentFirst ? "" : document.referrer });
    sentFirst = true;
    void fetch("/api/hit", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "x-lang": currentLang() }, body }).catch(() => undefined);
  } catch {
    // Stats never get in the way.
  }
}

/** A small flag picture: Windows draws no flag emoji, so emoji would show as two letters. */
function Flag(props: { code: string }) {
  if (!/^[A-Z]{2}$/.test(props.code)) return <span className="stats-flag unknown" aria-hidden="true" />;
  return <img className="stats-flag" src={`https://flagcdn.com/w40/${props.code.toLowerCase()}.png`} alt="" width={20} height={15} loading="lazy" />;
}

const SPANS = [1, 7, 30, 90] as const;

/** The owner's view of who visits: per day, country, source, page and language. */
export function StatsPage() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [span, setSpan] = useState<number>(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account.admin) return;
    let alive = true;
    const load = () =>
      fetch(`/api/stats?days=${span}`, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error(response.statusText);
          return (await response.json()) as StatsResponse;
        })
        .then((answer) => alive && setData(answer))
        .catch((failure) => alive && setError(String(failure)));
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [account.admin, span]);

  const countryName = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([lang], { type: "region" });
      return (code: string) => (code === "??" ? "?" : (names.of(code) ?? code));
    } catch {
      return (code: string) => code;
    }
  }, [lang]);

  if (!account.ready) return null;
  if (!account.admin) return <p className="notice">404</p>;

  const today = data?.days[data.days.length - 1];
  const maxDay = Math.max(1, ...(data?.days.map((day) => day.visitors) ?? [1]));
  const named: Record<string, string> = { beatmap: t.statsMapPage, foryou: t.forYou, pinned: t.pinnedMaps, feedback: t.feedbackInbox };
  const pageName = (key: string) => (key.startsWith("maps:") ? `${t.statsMapsList} (${key.slice(5)})` : (named[key] ?? key));

  const list = (title: string, rows: { key: string; value: number }[], label: (key: string) => ReactNode) => {
    const max = Math.max(1, ...rows.map((row) => row.value));
    return (
      <section className="panel stats-list">
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p className="help">{t.statsEmpty}</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.key}>
                <span className="stats-bar" style={{ width: `${(row.value / max) * 100}%` }} />
                <span className="stats-key">{label(row.key)}</span>
                <span className="stats-value">{row.value.toLocaleString(lang)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <main className="stats-page">
      <div className="panel pinned-head">
        <h2>{t.stats}</h2>
        <div className="tabs" role="tablist">
          {SPANS.map((value) => (
            <button key={value} type="button" role="tab" aria-selected={span === value} className={`tab${span === value ? " on" : ""}`} onClick={() => setSpan(value)}>
              {value === 1 ? t.statsToday : `${value} ${t.statsDays}`}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      {data && (
        <>
          <div className="stats-cards">
            <div className="panel stats-card live">
              <span>{t.statsOnline}</span>
              <strong>{data.online.toLocaleString(lang)}</strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsVisitorsToday}</span>
              <strong>{(today?.visitors ?? 0).toLocaleString(lang)}</strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsVisits}</span>
              <strong>{data.visits.toLocaleString(lang)}</strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsViews}</span>
              <strong>{data.views.toLocaleString(lang)}</strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsSignedIn}</span>
              <strong>{data.signedIn.toLocaleString(lang)}</strong>
            </div>
          </div>

          {data.days.length > 1 && (
            <section className="panel stats-chart">
              <h3>{t.statsPerDay}</h3>
              <div className="stats-columns" role="img" aria-label={t.statsPerDay}>
                {data.days.map((day) => (
                  <div key={day.day} className="stats-column" title={`${new Date(day.day).toLocaleDateString(lang)} · ${day.visitors} / ${day.views}`}>
                    <span style={{ height: `${(day.visitors / maxDay) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="stats-axis">
                <span>{new Date(data.days[0].day).toLocaleDateString(lang, { day: "numeric", month: "short" })}</span>
                <span>{new Date(data.days[data.days.length - 1].day).toLocaleDateString(lang, { day: "numeric", month: "short" })}</span>
              </div>
            </section>
          )}

          <div className="stats-grid">
            {list(t.statsCountries, data.countries, (code) => (
              <>
                <Flag code={code} />
                {countryName(code)}
              </>
            ))}
            {list(t.statsSources, data.sources, (key) => (key === "direct" ? t.statsDirect : key))}
            {list(t.statsLangs, data.langs, (key) => key.toUpperCase())}
            {list(t.statsPages, data.pages, pageName)}
          </div>
        </>
      )}
    </main>
  );
}
