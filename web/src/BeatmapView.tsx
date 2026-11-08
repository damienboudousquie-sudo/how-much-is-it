import { useEffect, useRef, useState } from "react";
import {
  CONCRETE_STYLES,
  MODS_BY_MODE,
  defaultClockRate,
  matchesStyleScores,
  modRate,
  modeLabel,
  sanitizeMods,
  styleScores,
  toggleMod,
  type BeatmapStatus,
  type LookupResponse,
  type MapMeta,
  type MapStats,
  type Mode,
  type ModId,
  type ScoreResult,
} from "@osu-pp/shared";
import { ApiError, fetchCalculate, fetchLookup } from "./api";
import { formatBpm, formatLength, formatPercent, formatPp, formatRate, formatStars, formatStat, osuDirectUrl, osuMapUrl } from "./format";
import { StarPill } from "./Badges";
import { fill, useI18n, type Copy } from "./i18n";

export interface PlayPreset {
  mods: string[];
}

/** What the list already knows about a map, shown at once while the full sheet loads. */
export interface MapPreview {
  title: string;
  artist: string;
  version: string;
  creator: string;
  cover: string | null;
  stars: number;
  pp: number;
  mods: string[];
}

function rateKind(mods: readonly string[]): "DT" | "HT" | null {
  if (mods.includes("HT")) return "HT";
  if (mods.includes("DT") || mods.includes("NC")) return "DT";
  return null;
}

function statItems(mode: Mode, stats: MapStats, t: Copy): { key: string; label: string; value: string }[] {
  const items = [
    { key: "stars", label: t.stars, value: `${formatStars(stats.stars)}★` },
    { key: "length", label: t.length, value: formatLength(stats.lengthSeconds) },
    { key: "bpm", label: t.bpm, value: formatBpm(stats.bpm) },
    { key: "combo", label: t.maxCombo, value: `${stats.maxCombo}x` },
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
    items.push({ key: "keys", label: t.keys, value: stats.cs == null ? "—" : `${Math.round(stats.cs)}K` }, { key: "od", label: "OD", value: formatStat(stats.od) });
  }
  return items;
}

function breakdown(mode: Mode, score: ScoreResult, t: Copy): [string, number][] {
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

function parseAccuracy(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  return text.trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function parseCount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

export function BeatmapView(props: {
  id: number;
  setId?: number | null;
  preset: PlayPreset | null;
  preview: MapPreview | null;
  prefetched: LookupResponse | null;
  onOpen: (id: number, mode: Mode, setId?: number | null) => void;
  onLoaded: (meta: MapMeta) => void;
}) {
  const { t, lang } = useI18n();
  const [data, setData] = useState<LookupResponse | null>(null);
  const [mods, setMods] = useState<string[]>(() => props.preset?.mods ?? []);
  const [clockRate, setClockRate] = useState<number | null>(() => {
    const mods = props.preset?.mods ?? [];
    return rateKind(mods) ? defaultClockRate(mods) : null;
  });
  const [accuracyText, setAccuracyText] = useState("100");
  const [missesText, setMissesText] = useState("0");
  const [comboText, setComboText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const calcGen = useRef(0);

  const accuracy = parseAccuracy(accuracyText);
  const misses = parseCount(missesText) ?? 0;
  const combo = parseCount(comboText);
  const playValid = accuracy != null && Number.isInteger(misses) && (combo == null || Number.isInteger(combo)) && !(accuracy === 100 && misses > 0);

  // Load the map once per id. Mods and score fields are sent so the first answer is complete.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    if (props.prefetched && props.prefetched.meta.beatmapId === props.id) {
      setData(props.prefetched);
      props.onLoaded(props.prefetched.meta);
      return;
    }
    setData(null);
    fetchLookup({
      beatmapId: props.id,
      beatmapsetId: props.setId ?? undefined,
      mods,
      clockRate,
      accuracy: accuracy ?? 100,
      misses: accuracy === 100 ? 0 : Number.isInteger(misses) ? misses : 0,
      combo: combo != null && Number.isInteger(combo) ? combo : null,
    })
      .then((response) => {
        if (cancelled) return;
        const clean = sanitizeMods(mods, response.meta.mode);
        if (clean.join() !== mods.join()) setMods(clean);
        setData(response);
        props.onLoaded(response.meta);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof ApiError ? caught.message : t.searchFailed);
      });
    return () => {
      cancelled = true;
    };
    // Only a new map triggers a lookup; score changes go through calculate below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);

  // Recalculate when mods, speed or the score change.
  const loadedId = data?.meta.beatmapId;
  const loadedMode = data?.meta.mode;
  const firstCalc = useRef(true);
  useEffect(() => {
    if (loadedId == null || loadedMode == null) return;
    if (firstCalc.current) {
      firstCalc.current = false;
      return;
    }
    if (!playValid) return;
    const id = ++calcGen.current;
    const timer = window.setTimeout(() => {
      setCalculating(true);
      fetchCalculate({ beatmapId: loadedId, mode: loadedMode, mods, clockRate, accuracy: accuracy!, misses, combo })
        .then((response) => {
          if (id !== calcGen.current) return;
          setData((current) => (current ? { ...current, ...response, meta: current.meta } : current));
          setError(null);
        })
        .catch((caught: unknown) => {
          if (id === calcGen.current) setError(caught instanceof Error ? caught.message : t.searchFailed);
        })
        .finally(() => {
          if (id === calcGen.current) setCalculating(false);
        });
    }, 90);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedId, loadedMode, mods.join(), clockRate, accuracy, misses, combo]);

  async function copyValue(value: number, key: string) {
    try {
      await navigator.clipboard.writeText(value.toFixed(2));
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200);
    } catch {
      setError(t.copyFailed);
    }
  }

  function onToggle(mod: ModId) {
    if (!data) return;
    const next = toggleMod(mods, mod, data.meta.mode);
    const before = rateKind(mods);
    const after = rateKind(next);
    setMods(next);
    if (after == null) setClockRate(null);
    else if (before !== after) setClockRate(defaultClockRate(next));
  }

  if (!data) {
    if (error) {
      return (
        <p className="notice error" role="alert" data-testid="error">
          {error}
        </p>
      );
    }
    const preview = props.preview;
    return (
      <div className="sheet loading" aria-busy="true">
        {preview ? (
          <section className="hero" style={preview.cover ? { backgroundImage: `url(${preview.cover})` } : undefined}>
            <div className="hero-shade" />
            <div className="hero-body">
              <p className="kicker">
                <span className="badge plain">
                  <span className="spinner small" aria-hidden="true" /> {t.loading}
                </span>
              </p>
              <h1>{preview.title}</h1>
              <p className="hero-sub">
                {preview.artist} · <strong>{preview.version}</strong> · {preview.creator}
              </p>
              <p className="pattern">
                {formatStars(preview.stars)}★ · {formatPp(preview.pp)} pp SS{preview.mods.length > 0 ? ` · ${preview.mods.join("")}` : ""}
              </p>
            </div>
          </section>
        ) : (
          <div className="hero skeleton" />
        )}
        <div className="stats skeleton-row" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="skeleton" />
          ))}
        </div>
        <div className="columns" aria-hidden="true">
          <div className="card skeleton tall" />
          <div className="card skeleton tall" />
        </div>
      </div>
    );
  }

  const { meta: rawMeta, stats, curve, score, warnings, pattern, styles } = data;
  // Maps from the farm list come from a ranked-only database: if the set lookup failed, they are still ranked.
  const meta = rawMeta.status === "unknown" && props.preview ? { ...rawMeta, status: "ranked" as const } : rawMeta;
  const shownRate = clockRate ?? defaultClockRate(mods);
  const parts = breakdown(meta.mode, score, t);
  const profile = profileFor(meta.status, t);
  // Types depend on speed: re-score with the current mods (DT turns fast streams into speed).
  const rate = shownRate ?? modRate(mods);
  const scored = pattern ? styleScores(pattern, { version: meta.version }, rate) : styles;
  const types = scored ? CONCRETE_STYLES.filter((style) => matchesStyleScores(scored, style)).sort((a, b) => scored[b] - scored[a]) : [];
  const best = curve[0]?.pp ?? 1;
  const numberLocale = lang === "fr" ? "fr-FR" : lang === "es" ? "es-ES" : "en-US";

  return (
    <main className={calculating ? "sheet busy" : "sheet"}>
      <section className="hero" style={meta.cover ? { backgroundImage: `url(${meta.cover})` } : undefined}>
        <div className="hero-shade" />
        <div className="hero-body">
          <p className="kicker">
            <span className={`badge status-${meta.status}`}>{t.status[meta.status]}</span>
            <span className="badge plain">{modeLabel(meta.mode)}</span>
            {types.map((style) => (
              <span key={style} className={`badge type-${style}`} title={t.typeHelp[style]}>
                {t.styles[style]}
              </span>
            ))}
          </p>
          <h1>{meta.title}</h1>
          <p className="hero-sub">
            {meta.artist} · <strong>{meta.version}</strong> · {meta.creator}
          </p>
          {pattern && (
            <p className="pattern">
              {[
                pattern.streamShare >= 0.05 ? fill(t.patternStream, { share: formatPercent(pattern.streamShare) }) : null,
                pattern.longestStream >= 9 ? fill(t.patternLongest, { count: pattern.longestStream }) : null,
                pattern.jumpShare >= 0.05 ? fill(t.patternJump, { share: formatPercent(pattern.jumpShare) }) : null,
                fill(t.patternSliders, { share: formatPercent(pattern.sliderShare) }),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <div className="hero-actions">
            <a className="button" href={osuMapUrl(meta.beatmapsetId, meta.beatmapId, meta.mode)} target="_blank" rel="noreferrer">
              {t.openOnOsu} ↗
            </a>
            <a className="button ghost" href={osuDirectUrl(meta.beatmapsetId, meta.beatmapId)}>
              {t.osuDirect}
            </a>
          </div>
          {profile && <p className="profile">{profile}</p>}
        </div>
      </section>

      {meta.difficulties.length > 1 && (
        <div className="diffs" aria-label={t.difficulties}>
          {meta.difficulties.map((chip) => (
            <button
              type="button"
              key={chip.id}
              className={chip.id === meta.beatmapId ? "chip on" : "chip"}
              onClick={() => chip.id !== meta.beatmapId && props.onOpen(chip.id, chip.mode, meta.beatmapsetId)}
            >
              {chip.stars != null && <StarPill stars={chip.stars} />}
              {chip.version}
              {chip.mode !== meta.mode && <small>{modeLabel(chip.mode)}</small>}
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

      <div className="play-mods">
        <div className="mods" role="group" aria-label={t.mods}>
          {MODS_BY_MODE[meta.mode].map((mod) => (
            <button
              type="button"
              key={mod}
              data-testid={`mod-${mod}`}
              aria-pressed={mods.includes(mod)}
              className={`mod mod-${mod}${mods.includes(mod) ? " on" : ""}`}
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
      </div>

      <div className="columns">
        <section className="card">
          <header className="card-head">
            <h2>{t.fullCombo}</h2>
            <span className="help">{t.copyHint}</span>
          </header>
          <div className="curve" data-testid="curve">
            {curve.map((point) => {
              const selected = score.misses === 0 && combo == null && accuracy != null && Math.abs(accuracy - point.accuracy) < 0.001;
              return (
                <button
                  type="button"
                  key={point.accuracy}
                  className={selected ? "curve-row on" : "curve-row"}
                  onClick={() => void copyValue(point.pp, `curve-${point.accuracy}`)}
                >
                  <span className="curve-acc">{point.accuracy}%</span>
                  <span className="curve-bar">
                    <span style={{ width: `${Math.max(2, (point.pp / best) * 100)}%` }} />
                  </span>
                  <span className="curve-pp">{copied === `curve-${point.accuracy}` ? t.copied : `${formatPp(point.pp, 2)} pp`}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="card sim">
          <header className="card-head">
            <h2>{t.simulated}</h2>
          </header>
          <div className="fields">
            <label>
              <span>{t.accuracy}</span>
              <input
                data-testid="accuracy"
                inputMode="decimal"
                value={accuracyText}
                aria-invalid={accuracy == null}
                onChange={(event) => setAccuracyText(event.target.value)}
              />
            </label>
            <label>
              <span>{t.combo}</span>
              <input
                data-testid="combo"
                inputMode="numeric"
                placeholder={`${stats.maxCombo}`}
                value={comboText}
                aria-invalid={combo != null && !Number.isInteger(combo)}
                onChange={(event) => setComboText(event.target.value)}
              />
            </label>
            <label>
              <span>{t.misses}</span>
              <input
                data-testid="misses"
                inputMode="numeric"
                value={missesText}
                aria-invalid={!Number.isInteger(misses)}
                onChange={(event) => setMissesText(event.target.value)}
              />
            </label>
          </div>
          <button type="button" className="pp" data-testid="pp-value" onClick={() => void copyValue(score.pp, "pp")}>
            <strong>{formatPp(score.pp, 2)}</strong>
            <span>{copied === "pp" ? t.copied : "pp"}</span>
          </button>
          <p className="score-line">
            {fill(t.scoreLine, {
              accuracy: score.accuracy.toLocaleString(numberLocale, { maximumFractionDigits: 2 }),
              combo: score.combo,
              max: stats.maxCombo,
              misses: score.misses,
            })}
          </p>
          {parts.length > 0 && (
            <div className="parts">
              {parts.map(([label, value]) => (
                <span key={label}>
                  <small>{label}</small>
                  {formatPp(value)}
                </span>
              ))}
            </div>
          )}
          {combo != null && !Number.isInteger(combo) && <p className="notice warn">{t.comboInteger}</p>}
          {accuracy == null && <p className="notice warn">{t.accuracyRange}</p>}
          {accuracy === 100 && misses > 0 && <p className="notice warn">{t.ssMisses}</p>}
          {warnings.map((warning) => (
            <p className="notice warn" key={warning}>
              {warning}
            </p>
          ))}
          {error && (
            <p className="notice error" role="alert" data-testid="error">
              {error}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
