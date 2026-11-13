import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { previewUrl, stopPreview } from "./audioPreview";
import { useI18n } from "./i18n";
import { AutoPlayer, type PlayerStatus } from "./player/engine";
import { parseOsu } from "./player/osuFile";
import { loadSkin } from "./player/skin";
import { VolumeSlider } from "./VolumeSlider";

const VOLUME_KEY = "osu-pp-lookup:player-volume";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function savedVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(value) && localStorage.getItem(VOLUME_KEY) != null ? Math.max(0, Math.min(1, value)) : 0.6;
  } catch {
    return 0.6;
  }
}

const WIDTH = 540;
const SIZE_KEY = "osu-pp-lookup:player-size";

/** The size the player window had when it was last resized, kept inside the screen. */
function savedSize(): { width: number; height: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZE_KEY) ?? "null") as { width?: unknown; height?: unknown } | null;
    if (!raw || typeof raw.width !== "number" || typeof raw.height !== "number") return null;
    return {
      width: Math.max(360, Math.min(window.innerWidth - 24, raw.width)),
      height: Math.max(320, Math.min(window.innerHeight - 24, raw.height)),
    };
  } catch {
    return null;
  }
}

function saveSize(size: { width: number; height: number }): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ width: Math.round(size.width), height: Math.round(size.height) }));
  } catch {
    // Not remembered; the window still has this size now.
  }
}

/**
 * The map played by auto in the vv_idke_trail skin, in a medium window floating over the
 * page next to the button that opened it, like a link preview.
 */
export function AutoPlayerPopup(props: {
  anchor: HTMLElement | null;
  title: string;
  beatmapId: number;
  setId: number | null;
  mods: string[];
  rate: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // Set once the window is resized by its corner; until then it keeps its natural size.
  const [size, setSize] = useState<{ width: number; height: number } | null>(savedSize);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const update = () => setFull(document.fullscreenElement === box.current && box.current != null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void box.current?.requestFullscreen?.().catch(() => undefined);
  };

  // Resize by dragging the bottom-right corner.
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const start = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
    let last = { width: rect.width, height: rect.height };
    const move = (e: PointerEvent) => {
      last = {
        width: Math.max(360, Math.min(window.innerWidth - rect.left - 4, start.width + e.clientX - start.x)),
        height: Math.max(320, Math.min(window.innerHeight - rect.top - 4, start.height + e.clientY - start.y)),
      };
      setSize(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener(
      "pointerup",
      () => {
        window.removeEventListener("pointermove", move);
        // Reopens at this size next time.
        saveSize(last);
      },
      { once: true },
    );
  };

  // Open just under the button, kept inside the window.
  useLayoutEffect(() => {
    const width = size?.width ?? Math.min(WIDTH, window.innerWidth - 24);
    const height = size?.height ?? box.current?.offsetHeight ?? 460;
    const rect = props.anchor?.getBoundingClientRect();
    let left = rect ? rect.left : (window.innerWidth - width) / 2;
    let top = rect ? rect.bottom + 10 : 80;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    // Not enough room under the button: above it, else as low as fits.
    if (top + height > window.innerHeight - 12) top = rect && rect.top - height - 10 >= 12 ? rect.top - height - 10 : Math.max(12, window.innerHeight - height - 12);
    setPlace({ left, top });
  }, [props.anchor]);

  useEffect(() => {
    // In full screen, Escape only leaves full screen (the browser handles it).
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !document.fullscreenElement && props.onClose();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Mods stay usable while the player is open: it follows them live.
      if (document.fullscreenElement || box.current?.contains(target) || props.anchor?.contains(target) || (target as Element).closest?.(".play-mods")) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [props.onClose, props.anchor]);

  // Drag by the title bar.
  const drag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button") || !place) return;
    const start = { x: event.clientX, y: event.clientY, ...place };
    const move = (e: PointerEvent) =>
      setPlace({
        left: Math.max(0, Math.min(window.innerWidth - 120, start.left + e.clientX - start.x)),
        top: Math.max(0, Math.min(window.innerHeight - 60, start.top + e.clientY - start.y)),
      });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };

  return createPortal(
    <div
      ref={box}
      className={`auto-popup${size ? " sized" : ""}${full ? " full" : ""}`}
      role="dialog"
      aria-label={t.watchAuto}
      style={{
        width: size?.width ?? Math.min(WIDTH, window.innerWidth - 24),
        ...(size ? { height: size.height } : {}),
        ...(place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }),
      }}
    >
      <div className="auto-head" onPointerDown={drag} onDoubleClick={toggleFull}>
        <span className="auto-title">{props.title}</span>
        <button type="button" className="auto-close auto-full" aria-label={full ? t.exitFullscreen : t.fullscreen} title={full ? t.exitFullscreen : t.fullscreen} onClick={toggleFull}>
          {full ? (
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        <button type="button" className="auto-close" aria-label={t.hideAuto} onClick={props.onClose}>
          ×
        </button>
      </div>
      <AutoPlayerPanel beatmapId={props.beatmapId} setId={props.setId} mods={props.mods} rate={props.rate} />
      {!full && <div className="auto-resize" onPointerDown={resize} aria-hidden="true" />}
    </div>,
    document.body,
  );
}

function AutoPlayerPanel(props: { beatmapId: number; setId: number | null; mods: string[]; rate: number }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const player = useRef<AutoPlayer | null>(null);
  const song = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(false);
  const [musicState, setMusicState] = useState<"idle" | "loading" | "clip">("idle");
  const [volume, setVolume] = useState(savedVolume);

  const mods = {
    rate: props.rate,
    hr: props.mods.includes("HR"),
    ez: props.mods.includes("EZ"),
    hd: props.mods.includes("HD") || props.mods.includes("FL"),
    nc: props.mods.includes("NC"),
  };

  /** The whole song, pulled from the map's archive by the server; the 10 s clip if that fails. */
  async function startSong() {
    const p = player.current;
    if (!p) return;
    stopPreview();
    p.unlockAudio();
    setMusicState("loading");
    try {
      if (!song.current) {
        const response = await fetch(`/api/audio/${props.beatmapId}${props.setId != null ? `?s=${props.setId}` : ""}`);
        if (!response.ok) throw new Error(String(response.status));
        song.current = URL.createObjectURL(await response.blob());
      }
      if (player.current !== p) return;
      const ok = await p.playMusic(song.current, true);
      setMusicState("idle");
      if (ok) return;
    } catch {
      // Fall back to the preview clip below.
    }
    if (player.current !== p) return;
    setMusicState(props.setId != null ? "clip" : "idle");
    if (props.setId != null) await p.playMusic(previewUrl(props.setId), false);
  }

  useEffect(() => {
    let alive = true;
    setState("loading");
    const onStatus = (status: PlayerStatus) => {
      const span = status.duration - status.start || 1;
      if (fill.current) fill.current.style.width = `${Math.max(0, Math.min(100, ((status.time - status.start) / span) * 100))}%`;
      if (clock.current) clock.current.textContent = `${fmt(status.time)} / ${fmt(status.duration)}`;
      setPlaying((value) => (value === status.playing ? value : status.playing));
    };
    Promise.all([
      fetch(`/api/osu/${props.beatmapId}`).then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.text();
      }),
      loadSkin(),
    ])
      .then(([text, skin]) => {
        if (!alive || !canvas.current) return;
        const map = parseOsu(text);
        if (map.objects.length === 0) throw new Error("empty");
        player.current = new AutoPlayer(canvas.current, map, skin, onStatus);
        player.current.setMods(mods);
        player.current.setVolume(volume);
        setState("ready");
        // Opened by a click: start the whole song right away.
        void startSong();
      })
      .catch(() => alive && setState("error"));
    return () => {
      alive = false;
      player.current?.destroy();
      player.current = null;
      if (song.current) URL.revokeObjectURL(song.current);
      song.current = null;
    };
  }, [props.beatmapId]);

  useEffect(() => {
    player.current?.setMods(mods);
  }, [mods.rate, mods.hr, mods.ez, mods.hd, mods.nc, state]);

  const changeVolume = (value: number) => {
    setVolume(value);
    player.current?.setVolume(value);
    try {
      localStorage.setItem(VOLUME_KEY, String(value));
    } catch {
      // Not remembered; still applies now.
    }
  };

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || !player.current) return;
    const at = (x: number) => player.current?.seek((x - rect.left) / rect.width);
    at(event.clientX);
    const move = (e: PointerEvent) => at(e.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };

  return (
    <div className="auto-player" onPointerDown={() => player.current?.unlockAudio()}>
      <div className="auto-stage">
        <canvas ref={canvas} />
        <span className="auto-tag">AUTO</span>
        {state !== "ready" && <p className="auto-state">{state === "loading" ? t.playerLoading : t.playerError}</p>}
        {state === "ready" && musicState === "loading" && <p className="auto-music">{t.playerMusicLoading}</p>}
      </div>
      <div className="auto-controls">
        <button
          type="button"
          className="auto-play"
          aria-label={playing ? t.playerPause : t.playerPlay}
          // The map never moves without its music: play starts the music when there is none.
          disabled={state !== "ready" || musicState === "loading"}
          onClick={() => {
            const p = player.current;
            if (p && !p.togglePlay()) void startSong();
          }}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M7.5 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className={musicState === "clip" ? "auto-bar no-seek" : "auto-bar"} ref={bar} onPointerDown={seek}>
          <div className="auto-fill" ref={fill} />
        </div>
        <span className="auto-clock" ref={clock}>
          0:00 / 0:00
        </span>
        <VolumeSlider value={volume} onChange={changeVolume} />
      </div>
      <p className="auto-note">
        {musicState === "clip" ? `${t.playerClipOnly} · ` : ""}
        {t.playerCredit}
      </p>
    </div>
  );
}
