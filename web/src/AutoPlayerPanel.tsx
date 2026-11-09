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

  // Open just under the button, kept inside the window.
  useLayoutEffect(() => {
    const width = Math.min(WIDTH, window.innerWidth - 24);
    const height = box.current?.offsetHeight ?? 460;
    const rect = props.anchor?.getBoundingClientRect();
    let left = rect ? rect.left : (window.innerWidth - width) / 2;
    let top = rect ? rect.bottom + 10 : 80;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    // Not enough room under the button: above it, else as low as fits.
    if (top + height > window.innerHeight - 12) top = rect && rect.top - height - 10 >= 12 ? rect.top - height - 10 : Math.max(12, window.innerHeight - height - 12);
    setPlace({ left, top });
  }, [props.anchor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      // Mods stay usable while the player is open: it follows them live.
      if (box.current?.contains(target) || props.anchor?.contains(target) || (target as Element).closest?.(".play-mods")) return;
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
      className="auto-popup"
      role="dialog"
      aria-label={t.watchAuto}
      style={{ width: Math.min(WIDTH, window.innerWidth - 24), ...(place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: "hidden" }) }}
    >
      <div className="auto-head" onPointerDown={drag}>
        <span className="auto-title">{props.title}</span>
        <button type="button" className="auto-close" aria-label={t.hideAuto} onClick={props.onClose}>
          ×
        </button>
      </div>
      <AutoPlayerPanel beatmapId={props.beatmapId} setId={props.setId} mods={props.mods} rate={props.rate} />
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
  const [playing, setPlaying] = useState(true);
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
          disabled={state !== "ready"}
          onClick={() => player.current?.togglePlay()}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <div className="auto-bar" ref={bar} onPointerDown={seek}>
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
