import { useEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "./track";
import { modeLabel, parseInput, type Mode, type SearchHit } from "@osu-pp/shared";
import { fetchSearch, prefetchMap } from "./api";
import { StarPill } from "./Badges";
import { readJson, writeJson } from "./storage";
import { useI18n } from "./i18n";

export interface OpenTarget {
  id: number;
  mode: Mode;
  setId?: number | null;
}

export function SearchBox(props: {
  compact: boolean;
  onOpen: (target: OpenTarget) => void;
  onOpenSet: (setId: number) => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rankedOnly, setRankedOnly] = useState<boolean>(() => readJson<unknown>("osu-pp-lookup:ranked-only", false) === true);

  useEffect(() => writeJson("osu-pp-lookup:ranked-only", rankedOnly), [rankedOnly]);

  const flat = useMemo(() => results.flatMap((hit) => hit.beatmaps.map((beatmap) => ({ hit, beatmap }))), [results]);
  const parsed = useMemo(() => parseInput(query), [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    }
    function onPointer(event: MouseEvent) {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, []);

  useEffect(() => {
    if (parsed.kind !== "query" || parsed.query.trim().length < 2) {
      setResults([]);
      setMessage(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      fetchSearch(parsed.query, controller.signal, rankedOnly)
        .then((data) => {
          setResults(data.results);
          setMessage(data.message);
          setHighlight(0);
          setOpen(true);
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setMessage(caught instanceof Error ? caught.message : t.searchFailed);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 280);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [parsed, t, rankedOnly]);

  function choose(target: OpenTarget) {
    setOpen(false);
    inputRef.current?.blur();
    props.onOpen(target);
  }

  function submit() {
    if (parsed.kind === "beatmap") return choose({ id: parsed.beatmapId, mode: parsed.modeHint ?? "osu", setId: parsed.beatmapsetId });
    if (parsed.kind === "beatmapset") {
      setOpen(false);
      return props.onOpenSet(parsed.beatmapsetId);
    }
    const picked = flat[Math.min(highlight, flat.length - 1)];
    if (picked) choose({ id: picked.beatmap.id, mode: picked.beatmap.mode, setId: picked.hit.beatmapsetId });
    else setOpen(true);
  }

  const showList = open && (flat.length > 0 || Boolean(message));
  const direct = parsed.kind !== "query";

  return (
    <form
      ref={boxRef}
      className={props.compact ? "search compact" : "search"}
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        trackEvent("search");
        submit();
      }}
    >
      <label className="sr-only" htmlFor="search">
        {t.searchPlaceholder}
      </label>
      <div className="search-field">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="search"
          ref={inputRef}
          data-testid="search"
          placeholder={t.searchPlaceholder}
          value={query}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={showList}
          aria-controls="search-results"
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && flat.length > 0) {
              event.preventDefault();
              setOpen(true);
              setHighlight((index) => (index + 1) % flat.length);
            } else if (event.key === "ArrowUp" && flat.length > 0) {
              event.preventDefault();
              setHighlight((index) => (index - 1 + flat.length) % flat.length);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className={rankedOnly ? "ranked-toggle on" : "ranked-toggle"}
          aria-pressed={rankedOnly}
          title={t.rankedOnlyHelp}
          onClick={() => {
            setRankedOnly((value) => !value);
            inputRef.current?.focus();
          }}
        >
          <span className="ranked-check" aria-hidden="true">
            {rankedOnly ? "✓" : ""}
          </span>
          {t.rankedOnly}
        </button>
        {!props.compact && <kbd className="search-kbd" aria-hidden="true">/</kbd>}
        <button type="submit" className={direct ? "search-go ready" : "search-go"} disabled={props.busy}>
          {searching || props.busy ? <span className="spinner" aria-hidden="true" /> : t.open}
        </button>
      </div>
      {showList && (
        <div className="dropdown" id="search-results" role="listbox">
          {message && flat.length === 0 && <p className="dropdown-note">{message}</p>}
          {results.map((hit) => (
            <div className="hit" key={hit.beatmapsetId}>
              {hit.cover ? <img src={hit.cover} alt="" loading="lazy" /> : <span className="hit-fallback" />}
              <div className="hit-body">
                <div className="hit-title">
                  <strong>
                    {hit.title} <span className={`badge status-${hit.status}`}>{t.status[hit.status]}</span>
                  </strong>
                  <span>
                    {hit.artist} · {hit.creator}
                  </span>
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
                        onMouseEnter={() => {
                          setHighlight(index);
                          prefetchMap(beatmap.id, hit.beatmapsetId);
                        }}
                        onClick={() => choose({ id: beatmap.id, mode: beatmap.mode, setId: hit.beatmapsetId })}
                      >
                        {beatmap.stars != null && <StarPill stars={beatmap.stars} />}
                        {beatmap.version}
                        {beatmap.mode !== "osu" && <small>{modeLabel(beatmap.mode)}</small>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </form>
  );
}
