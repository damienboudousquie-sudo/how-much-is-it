import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { StatsResponse } from "@osu-pp/shared";
import { useAccount } from "./account";
import { useI18n } from "./i18n";

/** A small flag picture: Windows draws no flag emoji, so emoji would show as two letters. */
function Flag(props: { code: string }) {
  if (!/^[A-Z]{2}$/.test(props.code)) return <span className="stats-flag unknown" aria-hidden="true" />;
  return <img className="stats-flag" src={`https://flagcdn.com/w40/${props.code.toLowerCase()}.png`} alt="" width={20} height={15} loading="lazy" />;
}

const SPANS = [1, 7, 30, 90] as const;

type Count = { key: string; value: number };

function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Change against the period before: +12 % in green, -8 % in red (red is good for bounce). */
function Delta(props: { now: number; before: number; lowerIsBetter?: boolean }) {
  if (!props.before) return null;
  const change = (props.now - props.before) / props.before;
  if (!Number.isFinite(change) || Math.abs(change) < 0.005) return <span className="stats-delta flat">=</span>;
  const good = props.lowerIsBetter ? change < 0 : change > 0;
  return (
    <span className={`stats-delta ${good ? "up" : "down"}`}>
      {change > 0 ? "▲" : "▼"} {Math.abs(Math.round(change * 100))} %
    </span>
  );
}

/** The owner's view of who visits and what they do: no personal data is kept. */
export function StatsPage() {
  const { t, lang } = useI18n();
  const account = useAccount();
  const [span, setSpan] = useState<number>(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<"visitors" | "views">("visitors");

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

  const region = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([lang], { type: "region" });
      return (code: string) => (code === "??" ? "?" : (names.of(code) ?? code));
    } catch {
      return (code: string) => code;
    }
  }, [lang]);

  const language = useMemo(() => {
    try {
      const names = new Intl.DisplayNames([lang], { type: "language" });
      return (code: string) => (code === "?" ? "?" : `${names.of(code) ?? code} (${code.toUpperCase()})`);
    } catch {
      return (code: string) => code.toUpperCase();
    }
  }, [lang]);

  if (!account.ready) return null;
  if (!account.admin) return <p className="notice">404</p>;

  const number = (value: number) => Math.round(value).toLocaleString(lang);
  const percent = (value: number) => `${Math.round(value * 100)} %`;
  const named: Record<string, string> = { beatmap: t.statsMapPage, foryou: t.forYou, pinned: t.pinnedMaps, feedback: t.feedbackInbox, stats: t.stats };
  const pageName = (key: string) => (key.startsWith("maps:") ? `${t.statsMapsList} (${key.slice(5)})` : (named[key] ?? key));
  const deviceName: Record<string, string> = { desktop: t.statsDesktop, mobile: t.statsMobile, tablet: t.statsTablet };
  const eventName: Record<string, string> = {
    search: t.statsEvSearch,
    map_open: t.statsEvMapOpen,
    preview_play: t.statsEvPreview,
    auto_open: t.statsEvAuto,
    pin_farm: t.statsEvPinFarm,
    pin_done: t.statsEvPinDone,
    pin_clear: t.statsEvPinClear,
    login_click: t.statsEvLogin,
    feedback_open: t.statsEvFeedbackOpen,
    feedback_sent: t.statsEvFeedbackSent,
    lang_change: t.statsEvLang,
    foryou_refresh: t.statsEvForYou,
    mode_change: t.statsEvMode,
  };

  const list = (title: string, rows: Count[], label: (key: string) => ReactNode, wide = false) => {
    const max = Math.max(1, ...rows.map((row) => row.value));
    const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
    return (
      <section className={`panel stats-list${wide ? " wide" : ""}`}>
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p className="help">{t.statsEmpty}</p>
        ) : (
          <ul>
            {rows.map((row) => (
              <li key={row.key}>
                <span className="stats-bar" style={{ width: `${(row.value / max) * 100}%` }} />
                <span className="stats-key">{label(row.key)}</span>
                <span className="stats-value">
                  {number(row.value)}
                  <small>{Math.round((row.value / total) * 100)} %</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  const columns = (title: string, values: number[], labels: string[]) => {
    const max = Math.max(1, ...values);
    return (
      <section className="panel stats-chart small">
        <h3>{title}</h3>
        <div className="stats-columns">
          {values.map((value, index) => (
            <div key={index} className="stats-column" title={`${labels[index]} · ${number(value)}`}>
              <span style={{ height: `${(value / max) * 100}%` }} />
            </div>
          ))}
        </div>
        <div className="stats-axis many">
          {labels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
      </section>
    );
  };

  const exportCsv = () => {
    if (!data) return;
    const rows = [["day", "visitors", "views"], ...data.days.map((day) => [day.day, String(day.visitors), String(day.views)])];
    const blob = new Blob([rows.map((row) => row.join(",")).join("\n")], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `how-much-is-it-stats-${data.days[data.days.length - 1]?.day ?? "export"}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const today = data?.days[data.days.length - 1];
  const series = data?.days.map((day) => (metric === "visitors" ? day.visitors : day.views)) ?? [];
  const maxDay = Math.max(1, ...series);
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toLocaleDateString(lang, { weekday: "short", timeZone: "UTC" }));

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
          <button type="button" className="tab" onClick={exportCsv} disabled={!data}>
            {t.statsExport}
          </button>
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      {data && (
        <>
          <div className="stats-cards">
            <div className="panel stats-card live">
              <span>{t.statsOnline}</span>
              <strong>{number(data.online)}</strong>
              {data.onlinePages.length > 0 && <em>{data.onlinePages.map((row) => `${pageName(row.key)} ${row.value}`).join(" · ")}</em>}
            </div>
            <div className="panel stats-card">
              <span>{t.statsVisitorsToday}</span>
              <strong>{number(today?.visitors ?? 0)}</strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsVisits}</span>
              <strong>{number(data.visits)}</strong>
              <Delta now={data.visits} before={data.previous.visits} />
            </div>
            <div className="panel stats-card">
              <span>{t.statsViews}</span>
              <strong>{number(data.views)}</strong>
              <Delta now={data.views} before={data.previous.views} />
            </div>
            <div className="panel stats-card">
              <span>{t.statsPagesPerVisit}</span>
              <strong>{data.pagesPerVisit.toLocaleString(lang, { maximumFractionDigits: 1 })}</strong>
              <Delta now={data.pagesPerVisit} before={data.previous.pagesPerVisit} />
            </div>
            <div className="panel stats-card">
              <span>{t.statsAvgTime}</span>
              <strong>{duration(data.avgSeconds)}</strong>
              <Delta now={data.avgSeconds} before={data.previous.avgSeconds} />
            </div>
            <div className="panel stats-card">
              <span>{t.statsBounce}</span>
              <strong>{percent(data.bounceRate)}</strong>
              <Delta now={data.bounceRate} before={data.previous.bounceRate} lowerIsBetter />
            </div>
            <div className="panel stats-card">
              <span>{t.statsNewReturning}</span>
              <strong>
                {number(data.newVisits)} <small>/ {number(data.returning)}</small>
              </strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsSignedIn}</span>
              <strong>{number(data.signedIn)}</strong>
            </div>
            <div className="panel stats-card">
              <span>{t.statsLoad}</span>
              <strong>{data.avgLoadMs ? `${(data.avgLoadMs / 1000).toLocaleString(lang, { maximumFractionDigits: 1 })} s` : "—"}</strong>
            </div>
          </div>

          {data.days.length > 1 && (
            <section className="panel stats-chart">
              <div className="stats-chart-head">
                <h3>{t.statsPerDay}</h3>
                <div className="stats-switch">
                  <button type="button" className={metric === "visitors" ? "on" : ""} onClick={() => setMetric("visitors")}>
                    {t.statsChartVisitors}
                  </button>
                  <button type="button" className={metric === "views" ? "on" : ""} onClick={() => setMetric("views")}>
                    {t.statsChartViews}
                  </button>
                </div>
              </div>
              <div className="stats-columns" role="img" aria-label={t.statsPerDay}>
                {data.days.map((day, index) => (
                  <div key={day.day} className="stats-column" title={`${new Date(`${day.day}T12:00:00`).toLocaleDateString(lang)} · ${number(day.visitors)} / ${number(day.views)}`}>
                    <span style={{ height: `${(series[index] / maxDay) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="stats-axis">
                <span>{new Date(`${data.days[0].day}T12:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short" })}</span>
                <span>{new Date(`${data.days[data.days.length - 1].day}T12:00:00`).toLocaleDateString(lang, { day: "numeric", month: "short" })}</span>
              </div>
            </section>
          )}

          <div className="stats-grid two">
            {columns(t.statsHours, data.hours, data.hours.map((_, hour) => `${hour}h`))}
            {columns(t.statsWeekdays, data.weekdays, weekdayNames)}
          </div>

          <div className="stats-grid">
            {list(t.statsCountries, data.countries, (code) => (
              <>
                <Flag code={code} />
                {region(code)}
              </>
            ))}
            {list(t.statsSources, data.sources, (key) => (key === "direct" ? t.statsDirect : key))}
            {list(t.statsReferrers, data.referrers, (key) => key)}
            {list(t.statsCampaigns, data.campaigns, (key) => key)}
            {list(t.statsPages, data.pages, pageName)}
            {list(t.statsEvents, data.events, (key) => eventName[key] ?? key)}
            {list(t.statsDevices, data.devices, (key) => deviceName[key] ?? key)}
            {list(t.statsBrowsers, data.browsers, (key) => key)}
            {list(t.statsSystems, data.systems, (key) => key)}
            {list(t.statsScreens, data.screens, (key) => (key === "?" ? "?" : `${key} px`))}
            {list(t.statsLangs, data.langs, (key) => key.toUpperCase())}
            {list(t.statsBrowserLangs, data.browserLangs, language)}
          </div>

          <section className="panel stats-list wide">
            <h3>{t.statsMaps}</h3>
            {data.maps.length === 0 ? (
              <p className="help">{t.statsEmpty}</p>
            ) : (
              <ul>
                {data.maps.map((map) => (
                  <li key={map.id}>
                    <span className="stats-bar" style={{ width: `${(map.value / Math.max(1, data.maps[0].value)) * 100}%` }} />
                    <a className="stats-key" href={`#/osu/b/${map.id}`}>
                      {map.title || `#${map.id}`}
                    </a>
                    <span className="stats-value">{number(map.value)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}
