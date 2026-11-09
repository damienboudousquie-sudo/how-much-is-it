import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { previewUrl, stopPreview } from "./audioPreview";
import { useI18n } from "./i18n";
import { AutoPlayer, type PlayerStatus } from "./player/engine";
import { parseOsu } from "./player/osuFile";
import { loadSkin } from "./player/skin";

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The map played by auto in the vv_idke_trail skin, with the page's mods. */
export function AutoPlayerPanel(props: { beatmapId: number; setId: number | null; mods: string[]; rate: number }) {
  const { t } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const player = useRef<AutoPlayer | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(true);
  const [music, setMusic] = useState(false);
  const [hitsounds, setHitsounds] = useState(true);
  const [dance, setDance] = useState(true);

  const mods = {
    rate: props.rate,
    hr: props.mods.includes("HR"),
    ez: props.mods.includes("EZ"),
    hd: props.mods.includes("HD") || props.mods.includes("FL"),
    nc: props.mods.includes("NC"),
  };
  const song = useRef<string | null>(null);
  const [musicState, setMusicState] = useState<"idle" | "loading" | "clip">("idle");

  useEffect(() => {
    let alive = true;
    setState("loading");
    const onStatus = (status: PlayerStatus) => {
      const span = status.duration - status.start || 1;
      if (fill.current) fill.current.style.width = `${Math.max(0, Math.min(100, ((status.time - status.start) / span) * 100))}%`;
      if (clock.current) clock.current.textContent = `${fmt(status.time)} / ${fmt(status.duration)}`;
      setPlaying((value) => (value === status.playing ? value : status.playing));
      setMusic((value) => (value === status.music ? value : status.music));
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

  const unlock = () => player.current?.unlockAudio();

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

  const toggleMusic = async () => {
    const p = player.current;
    if (!p) return;
    if (p.hasMusic) {
      p.stopMusic();
      return;
    }
    await startSong();
  };

  const seek = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = bar.current?.getBoundingClientRect();
    if (!box || !player.current) return;
    const at = (x: number) => player.current?.seek((x - box.left) / box.width);
    at(event.clientX);
    const move = (e: PointerEvent) => at(e.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };

  return (
    <section className="auto-player panel" onPointerDown={unlock}>
      <div className="auto-stage">
        <canvas ref={canvas} />
        <span className="auto-tag">AUTO</span>
        {state !== "ready" && <p className="auto-state">{state === "loading" ? t.playerLoading : t.playerError}</p>}
      </div>
      <div className="auto-controls">
        <button
          type="button"
          className="auto-play"
          aria-label={playing ? t.playerPause : t.playerPlay}
          disabled={state !== "ready"}
          onClick={() => player.current?.togglePlay()}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="auto-bar" ref={bar} onPointerDown={seek}>
          <div className="auto-fill" ref={fill} />
        </div>
        <span className="auto-clock" ref={clock}>
          0:00 / 0:00
        </span>
        <span className="auto-sep" />
        <button
          type="button"
          className={music ? "on" : ""}
          aria-pressed={music}
          disabled={state !== "ready" || musicState === "loading"}
          onClick={() => void toggleMusic()}
        >
          ♪ {musicState === "loading" ? t.playerMusicLoading : t.playerMusic}
        </button>
        <button
          type="button"
          className={hitsounds ? "on" : ""}
          aria-pressed={hitsounds}
          onClick={() => {
            const next = !hitsounds;
            setHitsounds(next);
            if (player.current) player.current.hitsounds = next;
          }}
        >
          {t.playerHitsounds}
        </button>
        <button
          type="button"
          className={dance ? "on" : ""}
          aria-pressed={dance}
          onClick={() => {
            const next = !dance;
            setDance(next);
            if (player.current) player.current.dance = next;
          }}
        >
          {t.playerDance}
        </button>
      </div>
      <p className="auto-note">
        {musicState === "clip" ? `${t.playerClipOnly} · ` : ""}
        {t.playerSoundHint} · {t.playerCredit}
      </p>
    </section>
  );
}
