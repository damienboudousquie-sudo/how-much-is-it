import { AccountButton, LoginError } from "./Marks";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { DiscoverHit, Lang, LookupResponse, MapMeta, Mode } from "@osu-pp/shared";
import { fetchLookup } from "./api";
import { BeatmapView, type MapPreview, type PlayPreset } from "./BeatmapView";
import { Finder } from "./Finder";
import { plainClick } from "./format";
import { useI18n } from "./i18n";
import { beatmapPath, mapsPath, parseRoute, type AppRoute } from "./route";
import { SearchBox, type OpenTarget } from "./SearchBox";
import { Triangles } from "./Triangles";
import { readJson, writeJson } from "./storage";

interface RecentMap {
  id: number;
  mode: Mode;
  setId: number | null;
  title: string;
  artist: string;
  version: string;
}

const RECENT_KEY = "osu-pp-lookup:recent";
const LANGS: Lang[] = ["en", "fr", "es"];

function readRecent(): RecentMap[] {
  const parsed = readJson<unknown>(RECENT_KEY, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is RecentMap => Boolean(item) && typeof (item as RecentMap).id === "number")
    .map((item) => ({ ...item, mode: item.mode ?? "osu", setId: item.setId ?? null }))
    .slice(0, 8);
}

interface Navigation {
  id: number;
  setId?: number | null;
  preset: PlayPreset | null;
  preview: MapPreview | null;
  prefetched: LookupResponse | null;
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.hash, window.location.search));
  const [recent, setRecent] = useState<RecentMap[]>(readRecent);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const nav = useRef<Navigation | null>(null);
  const routeRef = useRef(route);
  const fromList = useRef(false);
  const mapsScroll = useRef(0);
  const mapsMode = useRef<Mode>(route.page === "maps" ? route.mode : "osu");
  routeRef.current = route;

  useEffect(() => {
    // Old links used ?b=123. Keep them working, then show the canonical hash.
    const initial = parseRoute(window.location.hash, window.location.search);
    const canonical = initial.page === "beatmap" ? beatmapPath(initial.mode, initial.id) : mapsPath(initial.mode);
    const url = new URL(window.location.href);
    url.searchParams.delete("b");
    const target = `${url.pathname}${url.search}${canonical}`;
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== target) window.history.replaceState(null, "", target);

    function onHash() {
      const next = parseRoute(window.location.hash, "");
      const previous = routeRef.current;
      if (previous.page === "maps" && next.page === "beatmap") {
        fromList.current = true;
        mapsScroll.current = window.scrollY;
        window.scrollTo(0, 0);
      } else if (next.page === "maps" && previous.page === "beatmap") {
        fromList.current = false;
        window.requestAnimationFrame(() => window.scrollTo(0, mapsScroll.current));
      }
      routeRef.current = next;
      setRoute(next);
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = route.page === "beatmap" && title ? `${title} · how much is it ?` : "how much is it ?";
  }, [route, title]);

  function open(target: OpenTarget, preset: PlayPreset | null = null, prefetched: LookupResponse | null = null, preview: MapPreview | null = null) {
    nav.current = { id: target.id, setId: target.setId, preset, prefetched, preview };
    const path = beatmapPath(target.mode, target.id);
    if (window.location.hash === path) {
      // Same map: remount the view so a new preset applies.
      setRoute({ page: "beatmap", mode: target.mode, id: target.id });
      return;
    }
    window.location.hash = path;
  }

  async function openSet(setId: number) {
    setResolving(true);
    setResolveError(null);
    try {
      const data = await fetchLookup({ beatmapsetId: setId, mods: [], clockRate: null, accuracy: 100, misses: 0, combo: null });
      open({ id: data.meta.beatmapId, mode: data.meta.mode, setId }, null, data);
    } catch (caught) {
      setResolveError(caught instanceof Error ? caught.message : t.searchFailed);
    } finally {
      setResolving(false);
    }
  }

  const onLoaded = useCallback((meta: MapMeta) => {
    setTitle(`${meta.artist} - ${meta.title} [${meta.version}]`);
    setRecent((current) => {
      const next = [
        { id: meta.beatmapId, mode: meta.mode, setId: meta.beatmapsetId, title: meta.title, artist: meta.artist, version: meta.version },
        ...current.filter((item) => item.id !== meta.beatmapId),
      ].slice(0, 8);
      writeJson(RECENT_KEY, next);
      return next;
    });
    const path = beatmapPath(meta.mode, meta.beatmapId);
    // A converted or redirected map: fix the address without adding history.
    if (routeRef.current.page === "beatmap" && window.location.hash !== path) {
      window.history.replaceState(null, "", path);
      const next = { page: "beatmap" as const, mode: meta.mode, id: meta.beatmapId };
      routeRef.current = next;
      setRoute(next);
    }
  }, []);

  function setFinderMode(mode: Mode) {
    if (window.location.hash !== mapsPath(mode)) window.history.replaceState(null, "", mapsPath(mode));
    const next = { page: "maps" as const, mode };
    routeRef.current = next;
    setRoute(next);
  }

  function backToMaps(event: MouseEvent<HTMLAnchorElement>, mode: Mode) {
    if (!plainClick(event)) return;
    event.preventDefault();
    if (fromList.current) window.history.back();
    else window.location.hash = mapsPath(mode);
  }

  const pending = nav.current && route.page === "beatmap" && nav.current.id === route.id ? nav.current : null;
  if (route.page === "maps") mapsMode.current = route.mode;
  const finderMode = mapsMode.current;

  return (
    <div className="app">
      <Triangles />
      <div className="backdrop" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" aria-label="how much is it ?" href={mapsPath(finderMode)} onClick={(event) => route.page === "beatmap" && backToMaps(event, finderMode)}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="30" />
              <text x="32" y="32" dy="0.35em" textAnchor="middle">
                how
              </text>
            </svg>
          </span>
          <span className="brand-text">
            much is it <span className="brand-q">?</span>
          </span>
        </a>
        <AccountButton />
        <div className="langs" role="group" aria-label="Language">
          {LANGS.map((code) => (
            <button key={code} type="button" className={lang === code ? "on" : ""} aria-pressed={lang === code} onClick={() => setLang(code)}>
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <LoginError />
      <SearchBox compact={route.page === "beatmap"} busy={resolving} onOpen={(target) => open(target)} onOpenSet={(setId) => void openSet(setId)} />
      {resolveError && (
        <p className="notice error" role="alert">
          {resolveError}
        </p>
      )}

      {route.page === "maps" && recent.length > 0 && (
        <nav className="recent" aria-label={t.recent}>
          <span className="label">{t.recent}</span>
          <div className="recent-list">
            {recent.map((item) => (
              <a
                key={item.id}
                href={beatmapPath(item.mode, item.id)}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  open({ id: item.id, mode: item.mode, setId: item.setId });
                }}
              >
                <strong>{item.title}</strong>
                <small>{item.version}</small>
              </a>
            ))}
          </div>
        </nav>
      )}

      {route.page === "beatmap" && (
        <>
          <a className="back" href={mapsPath(route.mode)} onClick={(event) => backToMaps(event, route.mode)}>
            ← {t.backToMaps}
          </a>
          <BeatmapView
            key={`${route.id}:${pending ? "nav" : "url"}:${pending?.preset?.mods.join("") ?? ""}`}
            id={route.id}
            setId={pending?.setId}
            preset={pending?.preset ?? null}
            preview={pending?.preview ?? null}
            prefetched={pending?.prefetched ?? null}
            onOpen={(id, mode, setId) => open({ id, mode, setId })}
            onLoaded={onLoaded}
          />
        </>
      )}

      {/* Kept mounted so results and scroll survive a visit to a map. */}
      <div hidden={route.page !== "maps"}>
        <Finder
          mode={finderMode}
          onMode={setFinderMode}
          onOpen={(hit: DiscoverHit) =>
            open({ id: hit.beatmapId, mode: hit.mode, setId: hit.beatmapsetId }, { mods: hit.mods }, null, {
              title: hit.title,
              artist: hit.artist,
              version: hit.version,
              creator: hit.creator,
              cover: hit.cover,
              stars: hit.stars,
              pp: hit.pp,
              mods: hit.mods,
            })
          }
        />
      </div>

      <footer className="footer">{t.footer}</footer>
    </div>
  );
}
