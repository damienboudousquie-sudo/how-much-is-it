import { useEffect, useMemo, useRef, useState } from "react";
import {
  DISCOVER_SORTS,
  FINDER_MODS,
  MAIN_STYLES,
  MAP_STYLES,
  PARENT_STYLE,
  SECONDARY_STYLES,
  MAX_SORT_RULES,
  RANGE_KEYS,
  SORT_KEYS,
  compareDiscover,
  cycleChoice,
  emptyFilters,
  legacySort,
  type ConcreteStyle,
  type DiscoverHit,
  type DiscoverResponse,
  type DiscoverSort,
  type FinderMod,
  type MapStyle,
  type ModChoice,
  type Mode,
  type NumRange,
  type RangeFilters,
  type RangeKey,
  type SortKey,
  type SortRule,
} from "@osu-pp/shared";
import { fetchDiscover, prefetchMap } from "./api";
import { useAccount } from "./account";
import { PinButton, PlayerBadges, pinSource } from "./Marks";
import { togglePreview, usePreviewPlaying } from "./audioPreview";
import { ModBadges, StarPill } from "./Badges";
import { formatBpm, formatCount, formatLength, formatPp, formatStat, plainClick } from "./format";
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
/** Direction a sort starts with when first picked. */
const DEFAULT_DIR: Record<SortKey, SortRule["dir"]> = { farm: "desc", pp: "desc", stars: "desc", length: "asc", bpm: "desc", ar: "desc" };
const DEFAULT_SORT: SortRule[] = [{ key: "farm", dir: "desc" }];

type RangeText = Record<RangeKey, { min: string; max: string }>;

interface Settings {
  ppMin: string;
  ppMax: string;
  query: string;
  /** Types to show, any of them. Empty means every type. */
  styles: ConcreteStyle[];
  /** Sort criteria, most important first. */
  sort: SortRule[];
  /** Raw text of the optional ranges, so a half-typed value is kept as typed. */
  ranges: RangeText;
  filters: Record<FinderMod, ModChoice>;
}

function emptyRangeText(): RangeText {
  return { stars: { min: "", max: "" }, bpm: { min: "", max: "" }, ar: { min: "", max: "" }, length: { min: "", max: "" } };
}

function readSettings(): Settings {
  const saved = readJson<Partial<Settings> & { sort?: unknown }>(SETTINGS_KEY, {});
  const filters = emptyFilters();
  for (const mod of FINDER_MODS) {
    const choice = saved.filters?.[mod];
    if (choice === "off" || choice === "on" || choice === "any") filters[mod] = choice;
  }
  const ranges = emptyRangeText();
  for (const key of RANGE_KEYS) {
    const value = saved.ranges?.[key];
    if (value && typeof value.min === "string" && typeof value.max === "string") ranges[key] = { min: value.min, max: value.max };
  }
  return {
    ppMin: typeof saved.ppMin === "string" ? saved.ppMin : "400",
    ppMax: typeof saved.ppMax === "string" ? saved.ppMax : "500",
    query: typeof saved.query === "string" ? saved.query : "",
    styles: readStyles(saved),
    sort: readSort(saved.sort),
    ranges,
    filters,
  };
}

function readSort(value: unknown): SortRule[] {
  // Settings saved before sorts could be combined held a single name.
  if (typeof value === "string" && DISCOVER_SORTS.includes(value as DiscoverSort)) return legacySort(value as DiscoverSort);
  if (!Array.isArray(value)) return DEFAULT_SORT;
  const rules = value.filter(
    (rule): rule is SortRule =>
      Boolean(rule) && SORT_KEYS.includes((rule as SortRule).key) && ((rule as SortRule).dir === "asc" || (rule as SortRule).dir === "desc"),
  );
  return rules.length > 0 ? rules.slice(0, MAX_SORT_RULES) : DEFAULT_SORT;
}

/** Tags that narrow Hybrid. Jump and Stream are not narrowed. */
const HYBRID_TAGS = SECONDARY_STYLES.filter((style) => PARENT_STYLE[style] === "hybrid");

/** Adds or removes a type. Removing Hybrid also drops its tags. */
function toggleStyle(styles: ConcreteStyle[], item: ConcreteStyle): ConcreteStyle[] {
  if (!styles.includes(item)) return [...styles, item];
  const without = styles.filter((style) => style !== item);
  return item === "hybrid" ? without.filter((style) => !(HYBRID_TAGS as readonly ConcreteStyle[]).includes(style)) : without;
}

function readStyles(saved: Partial<Settings> & { style?: unknown }): ConcreteStyle[] {
  const valid = (value: unknown): value is ConcreteStyle => typeof value === "string" && value !== "any" && MAP_STYLES.includes(value as MapStyle);
  // Speed is no longer a filter (only Hybrid can be narrowed); older saved settings may hold it.
  if (Array.isArray(saved.styles)) return [...new Set(saved.styles.filter(valid))].filter((style) => style !== "speed");
  return valid(saved.style) ? [saved.style] : [];
}

function parseRange(min: string, max: string): [number, number] | null {
  const low = Number(min.replace(",", ".").trim());
  const high = Number(max.replace(",", ".").trim());
  if (min.trim() === "" || max.trim() === "" || !Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (low < 0 || high > 5000 || low > high) return null;
  return [low, high];
}

const RANGE_LIMIT: Record<RangeKey, number> = { stars: 20, bpm: 2000, ar: 13, length: 3600 };

/** "1:30" or "90" for lengths, plain numbers otherwise. Empty is "no bound". Undefined means invalid. */
function parseBound(key: RangeKey, text: string): number | null | undefined {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;
  let parsed: number;
  if (key === "length" && value.includes(":")) {
    const match = /^(\d{1,3}):([0-5]?\d)$/.exec(value);
    if (!match) return undefined;
    parsed = Number(match[1]) * 60 + Number(match[2]);
  } else {
    parsed = Number(value);
  }
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= RANGE_LIMIT[key] ? parsed : undefined;
}

/** The ranges to send, or the keys that cannot be read. */
function parseRanges(text: RangeText): { ranges: RangeFilters; invalid: RangeKey[] } {
  const ranges = {} as RangeFilters;
  const invalid: RangeKey[] = [];
  for (const key of RANGE_KEYS) {
    const min = parseBound(key, text[key].min);
    const max = parseBound(key, text[key].max);
    if (min === undefined || max === undefined || (min != null && max != null && min > max)) {
      invalid.push(key);
      ranges[key] = { min: null, max: null };
    } else {
      ranges[key] = { min, max } satisfies NumRange;
    }
  }
  return { ranges, invalid };
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

  const { ppMin, ppMax, query, styles, sort, filters } = settings;
  const mode = props.mode;
  const parsedRanges = useMemo(() => parseRanges(settings.ranges), [settings.ranges]);

  const stylesKey = styles.join(",");
  const filtersKey = FINDER_MODS.map((mod) => filters[mod]).join(",");
  const sortKey = sort.map((rule) => `${rule.key}:${rule.dir}`).join(",");
  const rangesKey = JSON.stringify(parsedRanges.ranges);

  useEffect(() => writeJson(SETTINGS_KEY, settings), [settings]);

  function update(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function setBound(key: RangeKey, side: "min" | "max", value: string) {
    setSettings((current) => ({ ...current, ranges: { ...current.ranges, [key]: { ...current.ranges[key], [side]: value } } }));
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
        {
          query: query.trim(),
          mode,
          styles: mode === "osu" ? styles : [],
          mods: filters,
          ppMin: range[0],
          ppMax: range[1],
          offset,
          sort: sort.length > 0 ? sort : DEFAULT_SORT,
          ranges: parsedRanges.ranges,
        },
        current.signal,
      );
      if (current.signal.aborted || gen !== generation.current) return;
      const { results, ...rest } = data;
      setMeta(rest);
      const refreshing = (options.polls ?? 0) > 0 && (data.analyzing > 0 || data.catalog != null);
      setHits((previous) => {
        // While the server is still loading or reading maps, keep the order on screen steady:
        // only the type tags and farm scores of the maps already shown are updated. The new
        // order is applied once, when the work is finished.
        if (refreshing && previous.length > 0) {
          const fresh = new Map(results.map((hit) => [`${hit.beatmapId}:${hit.mods.join("")}`, hit]));
          return previous.map((hit) => {
            const update = fresh.get(`${hit.beatmapId}:${hit.mods.join("")}`);
            return update ? { ...hit, style: update.style, tags: update.tags, estimated: update.estimated, farm: update.farm } : hit;
          });
        }
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

  // Every filter change searches again. Typed fields wait for a short pause; buttons go at once.
  // A sort change reorders the maps on screen immediately, then the server fills in quietly.
  const typedKey = `${ppMin}|${ppMax}|${query}|${rangesKey}`;
  const clickedKey = `${mode}|${stylesKey}|${filtersKey}`;
  const lastKeys = useRef({ typed: typedKey, clicked: clickedKey, sort: sortKey });
  useEffect(() => {
    const last = lastKeys.current;
    lastKeys.current = { typed: typedKey, clicked: clickedKey, sort: sortKey };
    if (firstRun.current) {
      firstRun.current = false;
      void run();
      return;
    }
    const onlySort = last.typed === typedKey && last.clicked === clickedKey && last.sort !== sortKey;
    if (onlySort) {
      const rules = sort.length > 0 ? sort : DEFAULT_SORT;
      setHits((previous) => [...previous].sort((a, b) => compareDiscover(rules, a, b)));
      void run({ silent: true });
      return;
    }
    const typed = last.typed !== typedKey;
    const timer = window.setTimeout(() => void run(), typed ? 350 : 0);
    return () => window.clearTimeout(timer);
    // run reads the settings of this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typedKey, clickedKey, sortKey]);

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
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void run({ append: true });
      },
      { rootMargin: "600px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canLoadMore, meta?.nextOffset]);

  function toggleSort(key: SortKey) {
    const index = sort.findIndex((rule) => rule.key === key);
    if (index < 0) {
      if (sort.length >= MAX_SORT_RULES) return;
      update({ sort: [...sort, { key, dir: DEFAULT_DIR[key] }] });
    } else {
      update({ sort: sort.map((rule, at) => (at === index ? { ...rule, dir: rule.dir === "asc" ? "desc" : "asc" } : rule)) });
    }
  }

  function removeSort(key: SortKey) {
    const next = sort.filter((rule) => rule.key !== key);
    update({ sort: next.length > 0 ? next : DEFAULT_SORT });
  }

  const activePreset = useMemo(() => PRESETS.findIndex(([low, high]) => String(low) === ppMin.trim() && String(high) === ppMax.trim()), [ppMin, ppMax]);
  const rangesActive = RANGE_KEYS.some((key) => settings.ranges[key].min.trim() !== "" || settings.ranges[key].max.trim() !== "");
  const notices: string[] = [];
  if (meta?.styleIgnored) notices.push(t.styleIgnored);
  if (meta?.limitedFrom != null) notices.push(fill(t.limitedFrom, { pp: formatPp(meta.limitedFrom) }));
  if (parsedRanges.invalid.length > 0) notices.push(fill(t.rangeIgnored, { names: parsedRanges.invalid.map((key) => t.rangeLabels[key]).join(", ") }));

  return (
    <section className="finder" aria-labelledby="finder-title">
      <div className="panel listing">
        <header className="listing-head">
          <h2 id="finder-title">{t.finderTitle}</h2>
          <div className="tabs" role="radiogroup" aria-label={t.mode}>
            {MODES.map((item) => (
              <button
                type="button"
                key={item.id}
                role="radio"
                aria-checked={mode === item.id}
                className={mode === item.id ? "tab on" : "tab"}
                onClick={() => props.onMode(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </header>

        <label className="listing-search">
          <span className="sr-only">{t.keyword}</span>
          <input data-testid="finder-query" value={query} placeholder={t.keywordPlaceholder} onChange={(event) => update({ query: event.target.value })} />
        </label>

        <div className="rows">
          <div className="row">
            <span className="row-label">{t.range}</span>
            <div className="row-body">
              <div className="range">
                <input data-testid="pp-min" aria-label={t.ppMin} inputMode="decimal" value={ppMin} onChange={(event) => update({ ppMin: event.target.value })} />
                <span className="range-dash" aria-hidden="true">–</span>
                <input data-testid="pp-max" aria-label={t.ppMax} inputMode="decimal" value={ppMax} onChange={(event) => update({ ppMax: event.target.value })} />
                <span className="range-unit">pp</span>
              </div>
              <div className="tabs wrap">
                {PRESETS.map(([low, high], index) => (
                  <button
                    type="button"
                    key={low}
                    className={index === activePreset ? "tab on" : "tab"}
                    onClick={() => update({ ppMin: String(low), ppMax: String(high) })}
                  >
                    {low}–{high}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="row">
            <span className="row-label">{t.filters}</span>
            <div className="row-body">
              <div className="ranges">
                {RANGE_KEYS.map((key) => {
                  const bad = parsedRanges.invalid.includes(key);
                  const placeholder = key === "length" ? t.lengthPlaceholder : undefined;
                  return (
                    <div className={bad ? "mini-range bad" : "mini-range"} key={key}>
                      <span className="mini-label">{t.rangeLabels[key]}</span>
                      <input
                        aria-label={`${t.rangeLabels[key]} ${t.min}`}
                        inputMode={key === "length" ? "text" : "decimal"}
                        placeholder={placeholder ?? t.min}
                        aria-invalid={bad}
                        value={settings.ranges[key].min}
                        onChange={(event) => setBound(key, "min", event.target.value)}
                      />
                      <span className="range-dash" aria-hidden="true">–</span>
                      <input
                        aria-label={`${t.rangeLabels[key]} ${t.max}`}
                        inputMode={key === "length" ? "text" : "decimal"}
                        placeholder={placeholder ?? t.max}
                        aria-invalid={bad}
                        value={settings.ranges[key].max}
                        onChange={(event) => setBound(key, "max", event.target.value)}
                      />
                    </div>
                  );
                })}
                {rangesActive && (
                  <button type="button" className="tab clear" onClick={() => update({ ranges: emptyRangeText() })}>
                    {t.clearFilters}
                  </button>
                )}
              </div>
              <p className="help">{t.rangesHelp}</p>
            </div>
          </div>

          <div className="row">
            <span className="row-label">{t.type}</span>
            <div className="row-body">
              <div className="tabs wrap" role="group" aria-label={t.type} data-testid="finder-style">
                {(["any", ...MAIN_STYLES] as const).map((item) => {
                  const selected = item === "any" ? styles.length === 0 || mode !== "osu" : mode === "osu" && styles.includes(item);
                  return (
                    <button
                      type="button"
                      key={item}
                      aria-pressed={selected}
                      disabled={mode !== "osu" && item !== "any"}
                      className={`tab type type-${item}${selected ? " on" : ""}`}
                      title={t.typeHelp[item]}
                      onClick={() => update({ styles: item === "any" ? [] : toggleStyle(styles, item) })}
                    >
                      {t.styles[item]}
                    </button>
                  );
                })}
              </div>
              {mode === "osu" && styles.includes("hybrid") && (
              <div className="tabs wrap sub" role="group" aria-label={t.typeTags} data-testid="finder-tags">
                <span className="sub-label">{t.typeTags}</span>
                {HYBRID_TAGS.map((item) => {
                  const selected = mode === "osu" && styles.includes(item);
                  return (
                    <button
                      type="button"
                      key={item}
                      aria-pressed={selected}
                      disabled={mode !== "osu"}
                      className={`tab type type-${item}${selected ? " on" : ""}`}
                      title={t.typeHelp[item]}
                      onClick={() => update({ styles: toggleStyle(styles, item) })}
                    >
                      {t.styles[item]}
                    </button>
                  );
                })}
              </div>
              )}
              <p className="help">
                {mode === "osu" && styles.length > 0 ? styles.map((style) => t.typeHelp[style]).join(" ") : t.typeHelp.any}{" "}
                {mode === "osu" ? `${t.typeMulti} ${t.typeTagsHelp}` : ""}
              </p>
            </div>
          </div>

          <div className="row">
            <span className="row-label">{t.mods}</span>
            <div className="row-body">
              <div className="mod-filters">
                {FINDER_MODS.map((mod) => {
                  const choice = filters[mod];
                  return (
                    <button
                      type="button"
                      key={mod}
                      className={`mod-filter mod-${mod} ${choice}`}
                      aria-label={fill(t.modAria[choice], { mod })}
                      title={fill(t.modAria[choice], { mod })}
                      onClick={() => update({ filters: { ...filters, [mod]: cycleChoice(filters[mod]) } })}
                    >
                      <strong>{mod}</strong>
                      <small>{t.modState[choice]}</small>
                    </button>
                  );
                })}
              </div>
              <p className="help">{t.modHelp}</p>
            </div>
          </div>

          <div className="row">
            <span className="row-label">{t.sort}</span>
            <div className="row-body">
              <div className="sorts" data-testid="finder-sort">
                {SORT_KEYS.map((key) => {
                  const index = sort.findIndex((rule) => rule.key === key);
                  const rule = sort[index];
                  return (
                    <span key={key} className={rule ? "sort on" : "sort"}>
                      <button
                        type="button"
                        className="sort-main"
                        aria-pressed={Boolean(rule)}
                        title={rule ? t.sortFlip : t.sortAdd}
                        disabled={!rule && sort.length >= MAX_SORT_RULES}
                        onClick={() => toggleSort(key)}
                      >
                        {rule && sort.length > 1 && <span className="sort-rank">{index + 1}</span>}
                        {t.sortKeys[key]}
                        {rule && (
                          <span className="sort-dir" aria-label={rule.dir === "asc" ? t.ascending : t.descending}>
                            {rule.dir === "asc" ? "↑" : "↓"}
                          </span>
                        )}
                      </button>
                      {rule && (sort.length > 1 || key !== "farm") && (
                        <button type="button" className="sort-remove" aria-label={fill(t.sortRemove, { name: t.sortKeys[key] })} onClick={() => removeSort(key)}>
                          ×
                        </button>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="help">{t.sortHelp}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="results-head" aria-live="polite">
        {status.kind === "loading" && hits.length > 0 && (
          <p className="analyzing">
            <span className="spinner" aria-hidden="true" /> {t.searching}
          </p>
        )}
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

      {status.kind === "loading" && hits.length === 0 ? (
        <div className="map-list" aria-busy="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="map skeleton" key={index} />
          ))}
        </div>
      ) : (
        hits.length > 0 && (
          // While a new search runs, the previous results stay in place, slightly dimmed.
          <div className={status.kind === "loading" ? "map-list stale" : "map-list"} aria-busy={status.kind === "loading"} data-testid="finder-results">
            {hits.map((hit, index) => (
              <MapCard key={`${hit.beatmapId}-${hit.mods.join("")}`} hit={hit} rank={index + 1} showRank={sort[0]?.key === "farm"} onOpen={props.onOpen} />
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

/** Plays the map's osu! preview clip without opening the card: just a small triangle. */
function PreviewButton(props: { hit: DiscoverHit }) {
  const { t } = useI18n();
  const setId = props.hit.beatmapsetId!;
  const playing = usePreviewPlaying(setId);
  return (
    <button
      type="button"
      className={playing ? "map-play on" : "map-play"}
      aria-pressed={playing}
      aria-label={playing ? t.previewStop : t.previewPlay}
      title={playing ? t.previewStop : t.previewPlay}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePreview(setId, { title: props.hit.title, artist: props.hit.artist, cover: props.hit.cover });
      }}
    >
      {playing ? (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

export function MapCard(props: { hit: DiscoverHit; rank: number; showRank: boolean; hideFarm?: boolean; onOpen: (hit: DiscoverHit) => void }) {
  const { t } = useI18n();
  const { hit } = props;
  const account = useAccount();
  const [coverFailed, setCoverFailed] = useState(false);
  const tier = farmTier(hit.farm);
  const cardRef = useRef<HTMLAnchorElement>(null);

  // A card that stays on screen for a moment is probably about to be clicked: warm it up.
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer);
      if (entry?.isIntersecting) timer = window.setTimeout(() => prefetchMap(hit.beatmapId, hit.beatmapsetId), 700);
    });
    observer.observe(node);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [hit.beatmapId, hit.beatmapsetId]);

  const cover = hit.cover && !coverFailed ? hit.cover : null;
  const mark = account.markOf(hit.beatmapId);
  return (
    <a
      ref={cardRef}
      className={`map${tier ? ` farm-${tier}` : ""}${mark ? ` marked-${mark}` : ""}`}
      href={beatmapPath(hit.mode, hit.beatmapId)}
      onPointerEnter={() => prefetchMap(hit.beatmapId, hit.beatmapsetId)}
      onFocus={() => prefetchMap(hit.beatmapId, hit.beatmapsetId)}
      onTouchStart={() => prefetchMap(hit.beatmapId, hit.beatmapsetId)}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        props.onOpen(hit);
      }}
    >
      {cover && <span className="map-bg" style={{ backgroundImage: `url(${cover})` }} aria-hidden="true" />}
      <span className="map-cover">
        {cover ? <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setCoverFailed(true)} /> : null}
        {props.showRank && <span className="map-rank">#{props.rank}</span>}
        {hit.beatmapsetId != null && <PreviewButton hit={hit} />}
      </span>
      <span className="map-main">
        <span className="map-title">{hit.title}</span>
        <span className="map-sub">
          {hit.artist} · <em>{hit.version}</em> · {hit.creator}
        </span>
        <span className="map-tags">
          <StarPill stars={hit.stars} />
          <ModBadges mods={hit.mods} nm={t.nm} />
          {hit.style && (
            <span className={`tag type-${hit.style}${hit.estimated ? " estimated" : ""}`} title={hit.estimated ? t.estimated : t.typeHelp[hit.style]}>
              {t.styles[hit.style]}
              {hit.estimated ? " ?" : ""}
            </span>
          )}
          {hit.style &&
            (hit.tags ?? []).map((tag) => (
              <span key={tag} className={`tag sub type-${tag}${hit.estimated ? " estimated" : ""}`} title={t.typeHelp[tag]}>
                {t.styles[tag]}
              </span>
            ))}
          <PlayerBadges beatmapId={hit.beatmapId} pp={hit.pp} />
        </span>
        <span className="map-stats">
          <span title={t.length}>{formatLength(hit.lengthSeconds)}</span>
          <span>
            {hit.bpm != null ? formatBpm(hit.bpm) : "—"} <small>BPM</small>
          </span>
          <span>
            <small>AR</small> {formatStat(hit.ar)}
          </span>
        </span>
      </span>
      <span className="map-side">
        <PinButton beatmapId={hit.beatmapId} map={pinSource(hit)} />
        <span className="map-pp">
          {formatPp(hit.pp)}
          <small>pp</small>
        </span>
        {!props.hideFarm && (
          <span className="farm" title={t.farmHelp}>
            <span className="farm-bar">
              <span style={{ width: `${Math.max(4, hit.farm)}%` }} />
            </span>
            <span className="farm-label">
              {t.farm} {hit.farm}
            </span>
          </span>
        )}
      </span>
    </a>
  );
}
