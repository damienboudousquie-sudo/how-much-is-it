import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  FINDER_MODS,
  MAP_STYLES,
  MODS_BY_MODE,
  cycleChoice,
  defaultClockRate,
  emptyFilters,
  modeLabel,
  parseInput,
  sanitizeMods,
  toggleMod,
  type BeatmapStatus,
  type CurvePoint,
  type DiscoverHit,
  type DiscoverNotice,
  type DiscoverSort,
  type FinderMod,
  type LookupResponse,
  type MapMeta,
  type MapStats,
  type MapStyle,
  type ModChoice,
  type Mode,
  type ModId,
  type ScoreResult,
  type SearchHit,
} from "@osu-pp/shared";
import { ApiError, fetchCalculate, fetchDiscover, fetchLookup, fetchSearch } from "./api";
import { HexField } from "./HexField";
import { fill, useI18n, type Copy } from "./i18n";
import { beatmapPath, mapsPath, parseRoute, type AppRoute } from "./route";

interface RecentMap {
  id: number;
  title: string;
  artist: string;
  version: string;
}

const RECENT_KEY = "osu-pp-lookup:recent";
let numberLocale = "en-US";

function osuMapUrl(beatmapsetId: number | null, beatmapId: number, mode: Mode): string {
  const ruleset = mode === "catch" ? "fruits" : mode;
  if (beatmapsetId != null && beatmapsetId > 0) {
    return `https://osu.ppy.sh/beatmapsets/${beatmapsetId}#${ruleset}/${beatmapId}`;
  }
  return `https://osu.ppy.sh/beatmaps/${beatmapId}`;
}

function osuDirectUrl(beatmapsetId: number | null, beatmapId: number): string {
  if (beatmapsetId != null && beatmapsetId > 0) return `osu://dl/${beatmapsetId}`;
  return `osu://b/${beatmapId}`;
}

function formatPp(value: number): string {
  return value.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatStat(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString(numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatStars(value: number): string {
  return value.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBpm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toLocaleString(numberLocale, { maximumFractionDigits: 1 });
}

function formatLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatRate(value: number): string {
  return `${value.toLocaleString(numberLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

function rateKind(mods: readonly string[]): "DT" | "HT" | null {
  if (mods.includes("HT")) return "HT";
  if (mods.includes("DT") || mods.includes("NC")) return "DT";
  return null;
}

function readRecent(): RecentMap[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentMap[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "number").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(meta: MapMeta, current: RecentMap[]): RecentMap[] {
  const next = [
    { id: meta.beatmapId, title: meta.title, artist: meta.artist, version: meta.version },
    ...current.filter((item) => item.id !== meta.beatmapId),
  ].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  return next;
}

function statItems(mode: MapMeta["mode"], stats: MapStats, t: Copy): { key: string; label: string; value: string }[] {
  const items: { key: string; label: string; value: string }[] = [
    { key: "stars", label: t.stars, value: formatStars(stats.stars) },
    { key: "combo", label: t.maxCombo, value: String(stats.maxCombo) },
    { key: "bpm", label: t.bpm, value: formatBpm(stats.bpm) },
    { key: "length", label: t.length, value: formatLength(stats.lengthSeconds) },
  ];
  if (mode === "osu") {
    items.push(
      { key: "cs", label: "CS", value: formatStat(stats.cs) },
      { key: "ar", label: "AR", value: formatStat(stats.ar) },
      { key: "od", label: "OD", value: formatStat(stats.od) },
      { key: "hp", label: "HP", value: formatStat(stats.hp) },
    );
  } else if (mode === "taiko") {
    items.push({ key: "od", label: "OD", value: formatStat(stats.od) });
  } else if (mode === "catch") {
    items.push({ key: "cs", label: "CS", value: formatStat(stats.cs) }, { key: "ar", label: "AR", value: formatStat(stats.ar) });
  } else {
    items.push(
      { key: "keys", label: t.keys, value: stats.cs == null ? "—" : String(Math.round(stats.cs)) },
      { key: "od", label: "OD", value: formatStat(stats.od) },
    );
  }
  return items;
}

function breakdown(mode: MapMeta["mode"], score: ScoreResult, t: Copy): [string, number][] {
  const parts: [string, number][] = [];
  if (mode === "osu") {
    if (score.aim != null) parts.push([t.aim, score.aim]);
    if (score.speed != null) parts.push([t.speed, score.speed]);
    if (score.accuracyPp != null) parts.push([t.precision, score.accuracyPp]);
    if (score.flashlight != null && score.flashlight > 0.05) parts.push([t.flashlight, score.flashlight]);
  } else if (mode === "taiko") {
    if (score.difficultyPp != null) parts.push([t.difficulty, score.difficultyPp]);
    if (score.accuracyPp != null) parts.push([t.precision, score.accuracyPp]);
  } else if (score.difficultyPp != null) {
    parts.push([t.difficulty, score.difficultyPp]);
  }
  return parts;
}

function profileFor(status: BeatmapStatus, t: Copy): string | null {
  if (status === "loved" || status === "pending" || status === "graveyard" || status === "wip") return t.profileLoved;
  if (status === "qualified") return t.profileQualified;
  return null;
}

export function App() {
  const { t, lang, setLang } = useI18n();
  numberLocale = lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US";
  const inputRef = useRef<HTMLInputElement>(null);
  const modsRef = useRef<string[]>([]);
  const clockRef = useRef<number | null>(null);
  const accuracyRef = useRef(100);
  const missesRef = useRef(0);
  const comboRef = useRef("");
  const lookupGen = useRef(0);
  const calcGen = useRef(0);
  const holdCalc = useRef(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [dropdown, setDropdown] = useState(false);

  const [meta, setMeta] = useState<MapMeta | null>(null);
  const [stats, setStats] = useState<MapStats | null>(null);
  const [curve, setCurve] = useState<CurvePoint[]>([]);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [clockRate, setClockRate] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState(100);
  const [misses, setMisses] = useState(0);
  const [comboText, setComboText] = useState("");
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentMap[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [ppMin, setPpMin] = useState("500");
  const [ppMax, setPpMax] = useState("600");
  const [finderQuery, setFinderQuery] = useState("");
  const [finderMode, setFinderMode] = useState<Mode>("osu");
  const [finderStyle, setFinderStyle] = useState<MapStyle>("any");
  const [finderSort, setFinderSort] = useState<DiscoverSort>("pp-desc");
  const [filters, setFilters] = useState(emptyFilters);
  const [finderBusy, setFinderBusy] = useState(false);
  const [finderHits, setFinderHits] = useState<DiscoverHit[]>([]);
  const [finderNotice, setFinderNotice] = useState<DiscoverNotice | "invalid" | "failed" | "busy" | null>(null);
  const [finderStyleIgnored, setFinderStyleIgnored] = useState(false);
  const [finderError, setFinderError] = useState<string | null>(null);
  const [finderTotal, setFinderTotal] = useState(0);
  const [finderHasMore, setFinderHasMore] = useState(false);
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.hash, window.location.search));
  const finderAbort = useRef<AbortController | null>(null);
  const finderNext = useRef(0);
  const finderSortRef = useRef<DiscoverSort>("pp-desc");
  const finderSearched = useRef(false);
  const routeRef = useRef(route);
  const fromList = useRef(false);
  const mapsScroll = useRef(0);
  routeRef.current = route;

  modsRef.current = mods;
  clockRef.current = clockRate;
  accuracyRef.current = accuracy;
  missesRef.current = misses;
  comboRef.current = comboText;

  const flat = useMemo(
    () => results.flatMap((hit) => hit.beatmaps.map((beatmap) => ({ hit, beatmap }))),
    [results],
  );

  useEffect(() => {
    setRecent(readRecent());
    const initial = parseRoute(window.location.hash, window.location.search);
    const canonical = initial.page === "beatmap" ? beatmapPath(initial.mode, initial.id) : mapsPath(initial.mode);
    const url = new URL(window.location.href);
    url.searchParams.delete("b");
    const target = `${url.pathname}${url.search}${canonical}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) {
      window.history.replaceState(null, "", target);
    }
    routeRef.current = initial;
    setRoute(initial);
    if (initial.page === "beatmap") void openBeatmap(initial.id);
    else inputRef.current?.focus();

    function onHash() {
      const next = parseRoute(window.location.hash, "");
      const previous = routeRef.current;
      if (previous.page === "maps" && next.page === "beatmap") {
        fromList.current = true;
        mapsScroll.current = window.scrollY;
      }
      if (next.page === "maps") {
        fromList.current = false;
        setFinderMode(next.mode);
        window.requestAnimationFrame(() => window.scrollTo(0, mapsScroll.current));
      } else {
        window.scrollTo(0, 0);
        void openBeatmap(next.id);
      }
      routeRef.current = next;
      setRoute(next);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // The listener reads the latest openBeatmap after this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onPointer(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!inputRef.current?.parentElement?.contains(target)) setDropdown(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const parsed = parseInput(query);
    if (parsed.kind !== "query" || parsed.query.trim().length < 2) {
      setResults([]);
      setSearchMessage(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      void fetchSearch(parsed.query, controller.signal)
        .then((data) => {
          setResults(data.results);
          setSearchMessage(data.message);
          setHighlight(0);
          setDropdown(true);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setSearchMessage(caught instanceof Error ? caught.message : t.searchFailed);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!meta || holdCalc.current) return;
    const combo = comboText.trim();
    if (combo !== "" && !/^\d+$/.test(combo)) return;
    const timer = window.setTimeout(() => {
      void recalculate(meta.beatmapId, meta.mode);
    }, 50);
    return () => window.clearTimeout(timer);
    // recalculate reads the latest refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta?.beatmapId, meta?.mode, mods, clockRate, accuracy, misses, comboText]);

  useEffect(() => {
    if (route.page === "beatmap" && meta) document.title = `${meta.artist} - ${meta.title} · how much is it`;
    else document.title = "how much is it";
  }, [meta, route]);

  async function copyValue(value: number, key: string) {
    try {
      await navigator.clipboard.writeText(value.toFixed(2));
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200);
    } catch {
      setError(t.copyFailed);
    }
  }

  function playBody(beatmapId: number, mode?: MapMeta["mode"]) {
    const combo = comboRef.current.trim();
    return {
      beatmapId,
      mode,
      mods: modsRef.current,
      clockRate: clockRef.current,
      accuracy: accuracyRef.current,
      misses: missesRef.current,
      combo: combo === "" ? null : Number(combo),
    };
  }

  async function recalculate(beatmapId: number, mode: MapMeta["mode"]) {
    const id = ++calcGen.current;
    const lookup = lookupGen.current;
    setCalculating(true);
    try {
      const data = await fetchCalculate(playBody(beatmapId, mode));
      if (id !== calcGen.current || lookup !== lookupGen.current) return;
      setStats(data.stats);
      setCurve(data.curve);
      setScore(data.score);
      setWarnings(data.warnings);
      setError(null);
    } catch (caught) {
      if (id !== calcGen.current || lookup !== lookupGen.current) return;
      setError(caught instanceof Error ? caught.message : t.searchFailed);
    } finally {
      if (id === calcGen.current) setCalculating(false);
    }
  }

  function lookupPlay(beatmapId?: number) {
    if (accuracyRef.current === 100 && missesRef.current > 0) {
      missesRef.current = 0;
      setMisses(0);
    }
    if (comboRef.current.trim() !== "" && !/^\d+$/.test(comboRef.current.trim())) {
      comboRef.current = "";
      setComboText("");
    }
    return { ...playBody(beatmapId ?? 0), beatmapId, mode: undefined };
  }

  function setIdOrNothing(id: number | null | undefined): number | undefined {
    return id != null && Number.isInteger(id) && id > 0 ? id : undefined;
  }

  async function openBeatmap(beatmapId: number, beatmapsetId?: number | null) {
    const id = ++lookupGen.current;
    calcGen.current += 1;
    holdCalc.current = true;
    setLoading(true);
    setError(null);
    setDropdown(false);
    try {
      const data = await fetchLookup({
        ...lookupPlay(beatmapId),
        beatmapsetId: setIdOrNothing(beatmapsetId),
      });
      if (id !== lookupGen.current) return;
      applyLookup(data);
    } catch (caught) {
      if (id !== lookupGen.current) return;
      setError(caught instanceof ApiError ? caught.message : t.searchFailed);
    } finally {
      if (id === lookupGen.current) {
        holdCalc.current = false;
        setLoading(false);
      }
    }
  }

  async function openSet(beatmapsetId: number) {
    const id = ++lookupGen.current;
    calcGen.current += 1;
    holdCalc.current = true;
    setLoading(true);
    setError(null);
    setDropdown(false);
    try {
      const data = await fetchLookup({
        ...lookupPlay(undefined),
        beatmapsetId,
      });
      if (id !== lookupGen.current) return;
      applyLookup(data);
    } catch (caught) {
      if (id !== lookupGen.current) return;
      setError(caught instanceof Error ? caught.message : t.searchFailed);
    } finally {
      if (id === lookupGen.current) {
        holdCalc.current = false;
        setLoading(false);
      }
    }
  }

  function applyLookup(data: LookupResponse) {
    const nextMods = sanitizeMods(modsRef.current, data.meta.mode);
    const before = rateKind(modsRef.current);
    const after = rateKind(nextMods);
    setMods(nextMods);
    if (after == null) setClockRate(null);
    else if (before !== after) setClockRate(defaultClockRate(nextMods));
    setComboText("");
    setMeta(data.meta);
    setStats(data.stats);
    setCurve(data.curve);
    setScore(data.score);
    setWarnings(data.warnings);
    setRecent((current) => remember(data.meta, current));
    const path = beatmapPath(data.meta.mode, data.meta.beatmapId);
      if (window.location.hash !== path) {
      if (routeRef.current.page === "maps") {
        fromList.current = true;
        mapsScroll.current = window.scrollY;
        window.history.pushState(null, "", path);
        window.scrollTo(0, 0);
      } else {
        window.history.replaceState(null, "", path);
      }
    }
    const nextRoute: AppRoute = { page: "beatmap", mode: data.meta.mode, id: data.meta.beatmapId };
    routeRef.current = nextRoute;
    setRoute(nextRoute);
  }

  function openInPage(id: number, mode: Mode, setId?: number | null, playMods?: string[]) {
    if (playMods) {
      const next = sanitizeMods(playMods, mode);
      modsRef.current = next;
      setMods(next);
      const rate = rateKind(next) ? defaultClockRate(next) : null;
      clockRef.current = rate;
      setClockRate(rate);
      accuracyRef.current = 100;
      missesRef.current = 0;
      comboRef.current = "";
      setAccuracy(100);
      setMisses(0);
      setComboText("");
    }
    const path = beatmapPath(mode, id);
    if (window.location.hash === path) void openBeatmap(id, setId);
    else window.location.hash = path;
  }

  function backToMaps(event: ReactMouseEvent<HTMLAnchorElement>, mode: Mode) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (fromList.current) window.history.back();
    else window.location.hash = mapsPath(mode);
  }

  async function runFinder(append = false) {
    const min = Number(ppMin.replace(",", "."));
    const max = Number(ppMax.replace(",", "."));
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      setFinderHits([]);
      setFinderTotal(0);
      setFinderHasMore(false);
      setFinderNotice("invalid");
      setFinderError(null);
      return;
    }
    finderAbort.current?.abort();
    const controller = new AbortController();
    finderAbort.current = controller;
    finderSearched.current = true;
    const offset = append ? finderNext.current : 0;
    setFinderBusy(true);
    if (!append) setFinderNotice("busy");
    setFinderError(null);
    try {
      const data = await fetchDiscover(
        {
          query: finderQuery.trim(),
          mode: finderMode,
          style: finderMode === "osu" ? finderStyle : "any",
          mods: filters,
          ppMin: min,
          ppMax: max,
          offset,
          sort: finderSortRef.current,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      finderNext.current = data.nextOffset;
      setFinderTotal(data.total);
      setFinderHasMore(data.hasMore);
      setFinderHits((current) => {
        const merged = append ? [...current, ...data.results] : data.results;
        const seen = new Set<string>();
        return merged.filter((hit) => {
          const key = `${hit.beatmapId}:${hit.mods.join("")}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      });
      setFinderNotice(data.notice);
      setFinderStyleIgnored(data.styleIgnored);
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (!append) {
        setFinderHits([]);
        setFinderTotal(0);
        setFinderHasMore(false);
      }
      setFinderNotice("failed");
      setFinderError(caught instanceof Error ? caught.message : null);
    } finally {
      if (finderAbort.current === controller) setFinderBusy(false);
    }
  }

  function submitQuery() {
    const parsed = parseInput(query);
    if (parsed.kind === "beatmap") {
      openInPage(parsed.beatmapId, parsed.modeHint ?? "osu", parsed.beatmapsetId);
      return;
    }
    if (parsed.kind === "beatmapset") {
      void openSet(parsed.beatmapsetId);
      return;
    }
    if (flat.length > 0) {
      const picked = flat[Math.min(highlight, flat.length - 1)];
      if (picked) openInPage(picked.beatmap.id, picked.beatmap.mode, picked.hit.beatmapsetId);
      return;
    }
    setDropdown(true);
  }

  function onToggle(mod: ModId) {
    if (!meta) return;
    const next = toggleMod(mods, mod, meta.mode);
    const before = rateKind(mods);
    const after = rateKind(next);
    setMods(next);
    if (after == null) setClockRate(null);
    else if (before !== after) setClockRate(defaultClockRate(next));
  }

  function finderText(): string | null {
    if (finderNotice == null) return null;
    if (finderNotice === "invalid") return t.rangeInvalid;
    if (finderNotice === "busy") return t.searchingMaps;
    if (finderNotice === "failed") return finderError ?? t.searchFailed;
    const notice =
      finderNotice === "too_many" ? t.noticeTooMany : finderNotice === "none" ? t.noticeNone : finderNotice === "empty" ? t.noticeEmpty : t.noticePreview;
    const hasKeyword = finderQuery.trim().length > 0;
    const hasType = !hasKeyword && finderMode === "osu" && finderStyle !== "any";
    const countLabel = hasKeyword ? t.showingKeywordRange : hasType ? t.showingFiltered : t.showingAll;
    const count =
      finderTotal > 0
        ? fill(countLabel, {
            shown: finderHits.length.toLocaleString(numberLocale),
            total: finderTotal.toLocaleString(numberLocale),
          })
        : "";
    return [finderStyleIgnored ? t.styleIgnored : "", notice, count].filter(Boolean).join(" ");
  }

  const shownRate = clockRate ?? defaultClockRate(mods);
  const activeMods = meta ? MODS_BY_MODE[meta.mode] : [];

  return (
    <>
    <HexField />
    <div className="page">
      <header className="top">
        <div>
          <h1>{t.heading} ?</h1>
          <p className="lede">{t.lede}</p>
        </div>
        <div className="langs" role="group" aria-label="Language">
          {(["en", "fr", "es"] as const).map((code) => (
            <button key={code} type="button" className={lang === code ? "on" : ""} aria-pressed={lang === code} onClick={() => setLang(code)}>
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      {route.page === "beatmap" && (
        <a className="back" href={mapsPath(route.mode)} onClick={(event) => backToMaps(event, route.mode)}>
          {t.backToMaps}
        </a>
      )}

      <form
        className="search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitQuery();
        }}
      >
        <label className="sr-only" htmlFor="search">
          {t.searchLabel}
        </label>
        <input
          id="search"
          ref={inputRef}
          data-testid="search"
          placeholder={t.searchLabel}
          value={query}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={dropdown && (flat.length > 0 || Boolean(searchMessage))}
          aria-controls="search-results"
          onFocus={() => setDropdown(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && flat.length > 0) {
              event.preventDefault();
              setDropdown(true);
              setHighlight((index) => (index + 1) % flat.length);
            } else if (event.key === "ArrowUp" && flat.length > 0) {
              event.preventDefault();
              setHighlight((index) => (index - 1 + flat.length) % flat.length);
            } else if (event.key === "Escape") {
              setDropdown(false);
            }
          }}
        />
        <button type="submit">{searching ? "…" : t.see}</button>
        {dropdown && (flat.length > 0 || searchMessage) && (
          <div className="dropdown" id="search-results" role="listbox">
            {searchMessage && flat.length === 0 && <p className="dropdown-note">{searchMessage}</p>}
            {results.map((hit) => (
              <div className="hit" key={hit.beatmapsetId}>
                {hit.cover && <img src={hit.cover} alt="" />}
                <div className="hit-title">
                  <strong>{hit.artist}</strong> — {hit.title}
                  <span>{hit.creator}</span>
                </div>
                <div className="hit-diffs">
                  {hit.beatmaps.map((beatmap) => {
                    const index = flat.findIndex((item) => item.beatmap.id === beatmap.id);
                    return (
                      <button
                        type="button"
                        key={beatmap.id}
                        role="option"
                        aria-selected={index === highlight}
                        className={index === highlight ? "chip on" : "chip"}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setHighlight(index)}
                        onClick={() => openInPage(beatmap.id, beatmap.mode, hit.beatmapsetId)}
                      >
                        {beatmap.version}
                        <small>
                          {modeLabel(beatmap.mode)}
                          {beatmap.stars != null ? ` ${formatStars(beatmap.stars)}★` : ""}
                        </small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </form>

      {route.page === "maps" && (
      <Finder
        ppMin={ppMin}
        ppMax={ppMax}
        query={finderQuery}
        mode={finderMode}
        style={finderStyle}
        filters={filters}
        busy={finderBusy}
        hits={finderHits}
        hasMore={finderHasMore}
        message={finderText()}
        onPpMin={setPpMin}
        onPpMax={setPpMax}
        onQuery={setFinderQuery}
        onMode={(mode) => {
          setFinderMode(mode);
          if (mode !== "osu") setFinderStyle("any");
          if (routeRef.current.page === "maps" && window.location.hash !== mapsPath(mode)) {
            window.history.replaceState(null, "", mapsPath(mode));
            const next = { page: "maps" as const, mode };
            routeRef.current = next;
            setRoute(next);
          }
        }}
        onStyle={setFinderStyle}
        sort={finderSort}
        onSort={(sort) => {
          finderSortRef.current = sort;
          setFinderSort(sort);
          if (finderSearched.current) void runFinder(false);
        }}
        onCycle={(mod) => setFilters((current) => ({ ...current, [mod]: cycleChoice(current[mod]) }))}
        onSearch={() => void runFinder(false)}
        onMore={() => void runFinder(true)}
        onOpen={(hit) => openInPage(hit.beatmapId, hit.mode, hit.beatmapsetId, hit.mods)}
      />
      )}

      {route.page === "beatmap" && error && (
        <p className="banner" role="alert" data-testid="error">
          {error}
        </p>
      )}

      {route.page === "beatmap" && !error && !(meta && stats && score && meta.beatmapId === route.id) && (
        <p className="hint">{t.loading}</p>
      )}

      {route.page === "beatmap" && meta && stats && score && meta.beatmapId === route.id && (
        <main className={calculating || loading ? "sheet busy" : "sheet"}>
          <section
            className="hero"
            style={meta.cover ? { backgroundImage: `linear-gradient(90deg, rgba(12,10,16,0.92), rgba(12,10,16,0.55)), url(${meta.cover})` } : undefined}
          >
            <a className="hero-hit" href={osuMapUrl(meta.beatmapsetId, meta.beatmapId, meta.mode)} target="_blank" rel="noreferrer" aria-label={t.openOnOsu} />
            <div className="hero-body">
              <p className="kicker">
                <span className={`badge status-${meta.status}`}>{t.status[meta.status]}</span>
                <span>{modeLabel(meta.mode)}</span>
              </p>
              <h2>
                {meta.artist} — {meta.title}
              </h2>
              <p className="version">
                {meta.version} · {meta.creator}
              </p>
              {profileFor(meta.status, t) && <p className="profile">{profileFor(meta.status, t)}</p>}
              <a className="direct" href={osuDirectUrl(meta.beatmapsetId, meta.beatmapId)}>
                {t.osuDirect}
              </a>
            </div>
          </section>

          {meta.difficulties.length > 1 && (
            <div className="diffs" aria-label={t.difficulties}>
              {meta.difficulties.map((chip) => (
                <button
                  type="button"
                  key={chip.id}
                  className={chip.id === meta.beatmapId ? "chip on" : "chip"}
                  onClick={() => openInPage(chip.id, chip.mode, meta.beatmapsetId ?? undefined)}
                >
                  {chip.version}
                  <small>
                    {modeLabel(chip.mode)}
                    {chip.stars != null ? ` ${formatStars(chip.stars)}★` : ""}
                  </small>
                </button>
              ))}
            </div>
          )}

          <dl className="stats">
            {statItems(meta.mode, stats, t).map((item) => (
              <div key={item.key}>
                <dt>{item.label}</dt>
                <dd data-testid={item.key === "stars" ? "stars" : undefined}>{item.value}</dd>
              </div>
            ))}
          </dl>

          <div className="mods" role="group" aria-label={t.mods}>
            {activeMods.map((mod) => (
              <button
                type="button"
                key={mod}
                data-testid={`mod-${mod}`}
                aria-pressed={mods.includes(mod)}
                className={mods.includes(mod) ? "mod on" : "mod"}
                onClick={() => onToggle(mod)}
              >
                {mod}
              </button>
            ))}
          </div>

          {shownRate != null && (
            <label className="speed">
              <span>{fill(t.speedLabel, { rate: formatRate(shownRate) })}</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={shownRate}
                aria-valuetext={formatRate(shownRate)}
                onChange={(event) => setClockRate(Number(event.target.value))}
              />
            </label>
          )}

          <div className="columns">
            <section>
              <h3>{t.fullCombo}</h3>
              <div className="curve" data-testid="curve">
                {curve.map((point) => {
                  const selected = score.misses === 0 && comboText.trim() === "" && Math.abs(score.accuracy - point.accuracy) < 0.001;
                  return (
                    <button
                      type="button"
                      key={point.accuracy}
                      className={selected ? "curve-row on" : "curve-row"}
                      onClick={() => void copyValue(point.pp, `curve-${point.accuracy}`)}
                    >
                      <span>{point.accuracy} %</span>
                      <span>
                        {formatPp(point.pp)} pp
                        {copied === `curve-${point.accuracy}` ? ` · ${t.copied}` : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="sim">
              <h3>{t.simulated}</h3>
              <div className="fields">
                <label>
                  {t.accuracy}
                  <input
                    data-testid="accuracy"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={accuracy}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isFinite(next)) setAccuracy(Math.min(100, Math.max(0, next)));
                    }}
                  />
                </label>
                <label>
                  {t.combo}
                  <input
                    data-testid="combo"
                    type="number"
                    min={0}
                    step={1}
                    placeholder="max"
                    value={comboText}
                    onChange={(event) => setComboText(event.target.value)}
                  />
                </label>
                <label>
                  {t.misses}
                  <input
                    data-testid="misses"
                    type="number"
                    min={0}
                    step={1}
                    value={misses}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (Number.isInteger(next) && next >= 0) setMisses(next);
                    }}
                  />
                </label>
              </div>
              <button type="button" className="pp" data-testid="pp-value" onClick={() => void copyValue(score.pp, "pp")}>
                <strong>{formatPp(score.pp)}</strong>
                <span>pp{copied === "pp" ? ` · ${t.copied}` : ""}</span>
              </button>
              <p className="score-line">
                {fill(t.scoreLine, {
                  accuracy: score.accuracy.toLocaleString(lang === "en" ? "en-US" : lang === "es" ? "es-ES" : "fr-FR", { maximumFractionDigits: 2 }),
                  combo: score.combo,
                  max: stats.maxCombo,
                  misses: score.misses,
                })}
              </p>
              {breakdown(meta.mode, score, t).length > 0 && (
                <p className="parts">
                  {breakdown(meta.mode, score, t).map(([label, value]) => (
                    <span key={label}>
                      {label} {formatPp(value)}
                    </span>
                  ))}
                </p>
              )}
              {comboText.trim() !== "" && !/^\d+$/.test(comboText.trim()) && <p className="warn">{t.comboInteger}</p>}
              {warnings.map((warning) => (
                <p className="warn" key={warning}>
                  {warning}
                </p>
              ))}
            </section>
          </div>
        </main>
      )}

      {route.page === "maps" && recent.length > 0 && (
        <section className="recent">
          <h3>{t.recent}</h3>
          <div>
            {recent.map((item) => (
              <button type="button" key={item.id} onClick={() => openInPage(item.id, meta?.mode ?? finderMode)}>
                <strong>
                  {item.artist} — {item.title}
                </strong>
                <small>{item.version}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      <footer>{t.footer}</footer>
    </div>
    </>
  );
}

function Finder(props: {
  ppMin: string;
  ppMax: string;
  query: string;
  mode: Mode;
  style: MapStyle;
  sort: DiscoverSort;
  filters: Record<FinderMod, ModChoice>;
  busy: boolean;
  hits: DiscoverHit[];
  hasMore: boolean;
  message: string | null;
  onPpMin: (value: string) => void;
  onPpMax: (value: string) => void;
  onQuery: (value: string) => void;
  onMode: (mode: Mode) => void;
  onStyle: (style: MapStyle) => void;
  onSort: (sort: DiscoverSort) => void;
  onCycle: (mod: FinderMod) => void;
  onSearch: () => void;
  onMore: () => void;
  onOpen: (hit: DiscoverHit) => void;
}) {
  const { t } = useI18n();
  const modes: { id: Mode; label: string }[] = [
    { id: "osu", label: "osu!" },
    { id: "taiko", label: "osu!taiko" },
    { id: "catch", label: "osu!catch" },
    { id: "mania", label: "osu!mania" },
  ];
  return (
    <section className="finder">
      <h2>{t.finderTitle}</h2>
      <div className="fields">
        <label>
          {t.ppMin}
          <input data-testid="pp-min" inputMode="decimal" value={props.ppMin} onChange={(event) => props.onPpMin(event.target.value)} />
        </label>
        <label>
          {t.ppMax}
          <input data-testid="pp-max" inputMode="decimal" value={props.ppMax} onChange={(event) => props.onPpMax(event.target.value)} />
        </label>
        <label>
          {t.keyword}
          <input
            data-testid="finder-query"
            value={props.query}
            placeholder={t.optional}
            onChange={(event) => props.onQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="choice-block">
        <span className="choice-label" id="finder-mode-label">
          {t.mode}
        </span>
        <div className="ribbon" role="radiogroup" aria-labelledby="finder-mode-label">
          {modes.map((mode) => (
            <button
              type="button"
              key={mode.id}
              role="radio"
              aria-checked={props.mode === mode.id}
              className={props.mode === mode.id ? "on" : ""}
              onClick={() => props.onMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <div className="choice-block">
        <span className="choice-label" id="finder-style-label">{t.type}</span>
        <div className="ribbon" role="radiogroup" aria-labelledby="finder-style-label" data-testid="finder-style">
          {MAP_STYLES.map((style) => {
            const selected = props.mode === "osu" && props.style === style;
            return (
              <button
                type="button"
                key={style}
                role="radio"
                aria-checked={selected}
                disabled={props.mode !== "osu"}
                className={selected ? "on" : ""}
                onClick={() => props.onStyle(style)}
              >
                {t.styles[style]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="choice-block">
        <span className="choice-label" id="finder-sort-label">{t.sort}</span>
        <div className="ribbon" role="radiogroup" aria-labelledby="finder-sort-label" data-testid="finder-sort">
          {(
            [
              ["pp-desc", t.sortPpDesc],
              ["pp-asc", t.sortPpAsc],
              ["stars-desc", t.sortStarsDesc],
              ["stars-asc", t.sortStarsAsc],
              ["length-desc", t.sortLengthDesc],
              ["length-asc", t.sortLengthAsc],
            ] as const
          ).map(([sort, label]) => (
            <button
              type="button"
              key={sort}
              role="radio"
              aria-checked={props.sort === sort}
              className={props.sort === sort ? "on" : ""}
              onClick={() => props.onSort(sort)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mod-row" role="group" aria-label={t.modsLegend}>
        <p className="hint">{t.modHelp}</p>
        <div className="mod-chips">
          {FINDER_MODS.map((mod) => {
            const choice = props.filters[mod];
            const state = choice === "on" ? t.chipOn : choice === "any" ? t.chipAny : t.chipOff;
            return (
              <button
                type="button"
                key={mod}
                className={choice === "on" ? "mod-chip on" : choice === "any" ? "mod-chip any" : "mod-chip"}
                aria-pressed={choice === "on"}
                aria-label={fill(choice === "on" ? t.modOn : choice === "any" ? t.modAny : t.modOff, { mod })}
                onClick={() => props.onCycle(mod)}
              >
                <strong>{mod}</strong>
                <small>{state}</small>
              </button>
            );
          })}
        </div>
      </div>
      <button type="button" className="finder-go" data-testid="finder-search" disabled={props.busy} onClick={props.onSearch}>
        {props.busy ? "…" : t.searchRange}
      </button>
      {props.message && (
        <p className="hint" data-testid="finder-message">
          {props.message}
        </p>
      )}
      {props.hits.length > 0 && (
        <div className="finder-list" data-testid="finder-results">
          {props.hits.map((hit) => (
            <a
              key={`${hit.beatmapId}-${hit.mods.join("")}`}
              className="map-card"
              href={beatmapPath(hit.mode, hit.beatmapId)}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                props.onOpen(hit);
              }}
            >
              <Cover src={hit.cover} />
              <span className="map-copy">
                <strong>
                  {hit.artist} — {hit.title}
                </strong>
                <small>
                  {hit.creator} · {hit.version}
                  {hit.style ? ` · ${t.styles[hit.style]}` : ""} · {hit.mods.length > 0 ? hit.mods.join("") : t.nm}
                </small>
                <span className="pills">
                  {hit.lengthSeconds != null && <span>{formatLength(hit.lengthSeconds)}</span>}
                  <span>{formatStars(hit.stars)}★</span>
                </span>
              </span>
              <span className="map-pp">
                <strong>{formatPp(hit.pp)}</strong>
                <span>pp</span>
              </span>
            </a>
          ))}
        </div>
      )}
      {props.hasMore && props.hits.length > 0 && (
        <button type="button" className="finder-go" data-testid="finder-more" disabled={props.busy} onClick={props.onMore}>
          {props.busy ? "…" : t.showMore}
        </button>
      )}
    </section>
  );
}

function Cover(props: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!props.src || failed) return <span className="map-fallback" />;
  return <img src={props.src} alt="" onError={() => setFailed(true)} />;
}
