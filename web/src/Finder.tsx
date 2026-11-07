import { useEffect, useMemo, useRef, useState } from "react";
import {
  DISCOVER_SORTS,
  FINDER_MODS,
  MAP_STYLES,
  cycleChoice,
  emptyFilters,
  type DiscoverHit,
  type DiscoverResponse,
  type DiscoverSort,
  type FinderMod,
  type MapStyle,
  type ModChoice,
  type Mode,
} from "@osu-pp/shared";
import { fetchDiscover } from "./api";
import { formatCount, formatLength, formatPp, formatStars, plainClick } from "./format";
import { fill, useI18n } from "./i18n";
import { beatmapPath } from "./route";
import { readJson, writeJson } from "./storage";

const SETTINGS_KEY = "osu-pp-lookup:finder";
const PRESETS: [number, number][] = [
  [100, 200],
  [200, 300],
  [300, 400],
  [400, 500],
  [500, 600],
  [600, 700],
  [700, 800],
  [800, 1000],
];
const MODES: { id: Mode; label: string }[] = [
  { id: "osu", label: "osu!" },
  { id: "taiko", label: "taiko" },
  { id: "catch", label: "catch" },
  { id: "mania", label: "mania" },
];
const MAX_POLLS = 30;

interface Settings {
  ppMin: string;
  ppMax: string;
  query: string;
  style: MapStyle;
  sort: DiscoverSort;
  filters: Record<FinderMod, ModChoice>;
}

function readSettings(): Settings {
  const saved = readJson<Partial<Settings>>(SETTINGS_KEY, {});
  const filters = emptyFilters();
  for (const mod of FINDER_MODS) {
    const choice = saved.filters?.[mod];
    if (choice === "off" || choice === "on" || choice === "any") filters[mod] = choice;
  }
  return {
    ppMin: typeof saved.ppMin === "string" ? saved.ppMin : "400",
    ppMax: typeof saved.ppMax === "string" ? saved.ppMax : "500",
    query: typeof saved.query === "string" ? saved.query : "",
    style: MAP_STYLES.includes(saved.style as MapStyle) ? (saved.style as MapStyle) : "any",
    sort: DISCOVER_SORTS.includes(saved.sort as DiscoverSort) ? (saved.sort as DiscoverSort) : "farm",
    filters,
  };
}

function parseRange(min: string, max: string): [number, number] | null {
  const low = Number(min.replace(",", ".").trim());
  const high = Number(max.replace(",", ".").trim());
  if (min.trim() === "" || max.trim() === "" || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (low < 0 || high > 2000 || low > high) return null;
  return [low, high];
}

type Status = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "invalid" } | { kind: "done" };

export function Finder(props: { mode: Mode; onMode: (mode: Mode) => void; onOpen: (hit: DiscoverHit) => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<Settings>(readSettings);
  const [hits, setHits] = useState<DiscoverHit[]>([]);
  const [meta, setMeta] = useState<Omit<DiscoverResponse, "results"> | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [appending, setAppending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const pollTimer = useRef<number | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const firstRun = useRef(true);

  const { ppMin, ppMax, query, style, sort, filters } = settings;
  const mode = props.mode;
  const filtersKey = FINDER_MODS.map((mod) => filters[mod]).join(",");

  useEffect(() => writeJson(SETTINGS_KEY, settings), [settings]);

  function update(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  async function run(options: { append?: boolean; silent?: boolean; polls?: number } = {}) {
    const range = parseRange(ppMin, ppMax);
    if (!range) {
      controller.current?.abort();
      setStatus({ kind: "invalid" });
      setHits([]);
      setMeta(null);
      return;
    }
    if (pollTimer.current != null) window.clearTimeout(pollTimer.current);
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const gen = options.append ? generation.current : ++generation.current;
    const offset = options.append ? (meta?.nextOffset ?? 0) : 0;
    if (options.append) setAppending(true);
    else if (!options.silent) setStatus({ kind: "loading" });
    try {
      const data = await fetchDiscover(
        { query: query.trim(), mode, style: mode === "osu" ? style : "any", mods: filters, ppMin: range[0], ppMax: range[1], offset, sort },
        current.signal,
      );
      if (current.signal.aborted || gen !== generation.current) return;
      const { results, ...rest } = data;
      setMeta(rest);
      setHits((previous) => {
        if (!options.append) return results;
        const seen = new Set(previous.map((hit) => `${hit.beatmapId}:${hit.mods.join("")}`));
        return [...previous, ...results.filter((hit) => !seen.has(`${hit.beatmapId}:${hit.mods.join("")}`))];
      });
      setStatus({ kind: "done" });
      // The catalogue is still arriving, or types near the top are still being read: refresh quietly.
      const polls = options.polls ?? 0;
      if (!options.append && (data.analyzing > 0 || data.catalog) && polls < MAX_POLLS) {
        pollTimer.current = window.setTimeout(() => void run({ silent: true, polls: polls + 1 }), polls < 8 ? 1200 : 2500);
      }
    } catch (caught) {
      if (current.signal.aborted || gen !== generation.current) return;
      if (options.silent) return;
      setStatus({ kind: "error", message: caught instanceof Error ? caught.message : t.searchFailed });
      if (!options.append) setHits([]);
    } finally {
      if (options.append) setAppending(false);
    }
  }

  // Every filter change searches again, after a short pause while typing.
  useEffect(() => {
    const delay = firstRun.current ? 0 : 350;
    firstRun.current = false;
    const timer = window.setTimeout(() => void run(), delay);
    return () => window.clearTimeout(timer);
    // run reads the settings of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppMin, ppMax, query, mode, style, sort, filtersKey]);

  useEffect(
    () => () => {
      controller.current?.abort();
      if (pollTimer.current != null) window.clearTimeout(pollTimer.current);
    },
    [],
  );

  // Load the next page when the end of the list comes into view.
  const canLoadMore = status.kind === "done" && Boolean(meta?.hasMore) && !appending;
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !canLoadMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void run({ append: true });
    }, { rootMargin: "600px" });
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadMore, meta?.nextOffset]);

  const activePreset = useMemo(() => PRESETS.findIndex(([low, high]) => String(low) === ppMin.trim() && String(high) === ppMax.trim()), [ppMin, ppMax]);
  const notices: string[] = [];
  if (meta?.styleIgnored) notices.push(t.styleIgnored);
  if (meta?.limitedFrom != null) notices.push(fill(t.limitedFrom, { pp: formatPp(meta.limitedFrom) }));

  return (
    <section className="finder" aria-labelledby="finder-title">
      <div className="finder-head">
        <div>
          <h2 id="finder-title">{t.finderTitle}</h2>
          <p className="muted">{t.finderLede}</p>
        </div>
        <div className="segmented small" role="radiogroup" aria-label={t.mode}>
          {MODES.map((item) => (
            <button
              type="button"
              key={item.id}
              role="radio"
              aria-checked={mode === item.id}
              className={mode === item.id ? "on" : ""}
              onClick={() => props.onMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="controls">
        <div className="control">
          <span className="label">{t.range}</span>
          <div className="range">
            <label>
              <span className="sr-only">{t.ppMin}</span>
              <input data-testid="pp-min" inputMode="decimal" value={ppMin} placeholder={t.ppMin} onChange={(event) => update({ ppMin: event.target.value })} />
            </label>
            <span className="range-dash" aria-hidden="true">–</span>
            <label>
              <span className="sr-only">{t.ppMax}</span>
              <input data-testid="pp-max" inputMode="decimal" value={ppMax} placeholder={t.ppMax} onChange={(event) => update({ ppMax: event.target.value })} />
            </label>
            <span className="range-unit">pp</span>
          </div>
          <div className="presets">
            {PRESETS.map(([low, high], index) => (
              <button
                type="button"
                key={low}
                className={index === activePreset ? "preset on" : "preset"}
                onClick={() => update({ ppMin: String(low), ppMax: String(high) })}
              >
                {low}–{high}
              </button>
            ))}
          </div>
        </div>

        <div className="control">
          <span className="label">{t.type}</span>
          <div className="types" role="radiogroup" aria-label={t.type} data-testid="finder-style">
            {MAP_STYLES.map((item) => {
              const selected = mode === "osu" && style === item;
              return (
                <button
                  type="button"
                  key={item}
                  role="radio"
                  aria-checked={selected}
                  disabled={mode !== "osu" && item !== "any"}
                  className={`type type-${item}${selected ? " on" : ""}`}
                  title={t.typeHelp[item]}
                  onClick={() => update({ style: item })}
                >
                  {t.styles[item]}
                </button>
              );
            })}
          </div>
          <p className="help">{t.typeHelp[mode === "osu" ? style : "any"]}</p>
        </div>

        <div className="control-row">
          <div className="control">
            <span className="label">
              {t.mods} <span className="help inline">{t.modHelp}</span>
            </span>
            <div className="mod-filters">
              {FINDER_MODS.map((mod) => {
                const choice = filters[mod];
                return (
                  <button
                    type="button"
                    key={mod}
                    className={`mod-filter mod-${mod} ${choice}`}
                    aria-label={fill(t.modAria[choice], { mod })}
                    onClick={() => update({ filters: { ...filters, [mod]: cycleChoice(filters[mod]) } })}
                  >
                    <strong>{mod}</strong>
                    <small>{t.modState[choice]}</small>
                  </button>
                );
              })}
            </div>
          </div>
          <label className="control grow">
            <span className="label">{t.keyword}</span>
            <input data-testid="finder-query" value={query} placeholder={t.keywordPlaceholder} onChange={(event) => update({ query: event.target.value })} />
          </label>
          <label className="control">
            <span className="label">{t.sort}</span>
            <select data-testid="finder-sort" value={sort} onChange={(event) => update({ sort: event.target.value as DiscoverSort })}>
              {DISCOVER_SORTS.map((item) => (
                <option key={item} value={item}>
                  {t.sorts[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="results-head" aria-live="polite">
        {status.kind === "invalid" && <p className="notice warn">{t.rangeInvalid}</p>}
        {status.kind === "error" && <p className="notice error">{status.message}</p>}
        {status.kind === "done" && meta && (
          <>
            <p className="count">
              <strong>{fill(t.resultsCount, { total: formatCount(meta.total) })}</strong>
              <span className="muted"> · {t.ssNote}</span>
            </p>
            {meta.catalog && (
              <p className="analyzing">
                <span className="spinner" aria-hidden="true" />{" "}
                {fill(t.loadingCatalog, { loaded: formatCount(meta.catalog.loaded), expected: formatCount(meta.catalog.expected) })}
              </p>
            )}
            {!meta.catalog && meta.analyzing > 0 && (
              <p className="analyzing">
                <span className="spinner" aria-hidden="true" /> {fill(t.analyzing, { count: formatCount(meta.analyzing) })}
              </p>
            )}
          </>
        )}
        {notices.map((notice) => (
          <p className="notice" key={notice}>
            {notice}
          </p>
        ))}
        {status.kind === "done" && meta && hits.length === 0 && meta.analyzing === 0 && !meta.catalog && (
          <p className="notice">{meta.notice === "too_many" ? t.noticeTooMany : t.noticeNone}</p>
        )}
      </div>

      {status.kind === "loading" ? (
        <div className="map-list" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="map skeleton" key={index} />
          ))}
        </div>
      ) : (
        hits.length > 0 && (
          <div className="map-list" data-testid="finder-results">
            {hits.map((hit, index) => (
              <MapCard key={`${hit.beatmapId}-${hit.mods.join("")}`} hit={hit} rank={index + 1} sort={sort} onOpen={props.onOpen} />
            ))}
          </div>
        )
      )}

      {status.kind === "done" && meta?.hasMore && (
        <div ref={sentinel} className="more">
          <button type="button" className="ghost" data-testid="finder-more" disabled={appending} onClick={() => void run({ append: true })}>
            {appending ? <span className="spinner" aria-hidden="true" /> : t.showMore}
          </button>
        </div>
      )}
    </section>
  );
}

function farmTier(score: number): string {
  if (score >= 75) return "hot";
  if (score >= 60) return "good";
  return "";
}

function MapCard(props: { hit: DiscoverHit; rank: number; sort: DiscoverSort; onOpen: (hit: DiscoverHit) => void }) {
  const { t } = useI18n();
  const { hit } = props;
  const [coverFailed, setCoverFailed] = useState(false);
  const tier = farmTier(hit.farm);
  return (
    <a
      className={`map${tier ? ` farm-${tier}` : ""}`}
      href={beatmapPath(hit.mode, hit.beatmapId)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        props.onOpen(hit);
      }}
    >
      <span className="map-cover">
        {hit.cover && !coverFailed ? <img src={hit.cover} alt="" loading="lazy" decoding="async" onError={() => setCoverFailed(true)} /> : null}
        {props.sort === "farm" && <span className="map-rank">#{props.rank}</span>}
      </span>
      <span className="map-main">
        <span className="map-title">{hit.title}</span>
        <span className="map-sub">
          {hit.artist} · <em>{hit.version}</em> · {hit.creator}
        </span>
        <span className="map-tags">
          <span className="tag stars">★ {formatStars(hit.stars)}</span>
          <span className="tag">{formatLength(hit.lengthSeconds)}</span>
          <span className={hit.mods.length > 0 ? "tag mods" : "tag"}>{hit.mods.length > 0 ? hit.mods.join("") : t.nm}</span>
          {hit.style && (
            <span className={`tag type-${hit.style}${hit.estimated ? " estimated" : ""}`} title={hit.estimated ? t.estimated : t.typeHelp[hit.style]}>
              {t.styles[hit.style]}
              {hit.estimated ? " ?" : ""}
            </span>
          )}
        </span>
      </span>
      <span className="map-side">
        <span className="map-pp">
          {formatPp(hit.pp)}
          <small>pp</small>
        </span>
        <span className="farm" title={t.farmHelp}>
          <span className="farm-bar">
            <span style={{ width: `${Math.max(4, hit.farm)}%` }} />
          </span>
          <span className="farm-label">
            {t.farm} {hit.farm}
          </span>
        </span>
      </span>
    </a>
  );
}
