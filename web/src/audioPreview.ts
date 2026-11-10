import { useEffect, useState } from "react";
import { trackEvent } from "./track";

/** The 10 s preview clip osu! serves for every beatmapset. */
export function previewUrl(setId: number): string {
  return `https://b.ppy.sh/preview/${setId}.mp3`;
}

export interface PreviewInfo {
  title: string;
  artist: string;
  cover: string | null;
}

export interface PreviewState {
  setId: number | null;
  info: PreviewInfo | null;
  playing: boolean;
  time: number;
  duration: number;
  volume: number;
}

const VOLUME_KEY = "osu-pp-lookup:preview-volume";

function savedVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0.5;
  } catch {
    return 0.5;
  }
}

let audio: HTMLAudioElement | null = null;
let state: PreviewState = { setId: null, info: null, playing: false, time: 0, duration: 0, volume: savedVolume() };
const listeners = new Set<() => void>();

function set(next: Partial<PreviewState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Stops and closes the preview, e.g. when the auto player starts its own music. */
export function stopPreview(): void {
  if (audio) audio.pause();
  audio = null;
  set({ setId: null, info: null, playing: false, time: 0, duration: 0 });
}

/** Plays a set's preview, or pauses / resumes it if it is the current one. One at a time. */
export function togglePreview(setId: number, info: PreviewInfo | null = null): void {
  if (state.setId === setId && audio) {
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
    return;
  }
  if (audio) audio.pause();
  trackEvent("preview_play");
  const next = new Audio(previewUrl(setId));
  next.volume = state.volume;
  const mine = () => audio === next;
  next.addEventListener("play", () => mine() && set({ playing: true }));
  next.addEventListener("pause", () => mine() && set({ playing: false }));
  next.addEventListener("ended", () => mine() && set({ playing: false, time: 0 }));
  next.addEventListener("timeupdate", () => mine() && set({ time: next.currentTime }));
  next.addEventListener("loadedmetadata", () => mine() && set({ duration: next.duration || 0 }));
  next.addEventListener("error", () => mine() && stopPreview());
  audio = next;
  set({ setId, info, playing: true, time: 0, duration: 0 });
  void next.play().catch(() => mine() && set({ playing: false }));
}

export function seekPreview(fraction: number): void {
  if (!audio || !state.duration) return;
  audio.currentTime = Math.max(0, Math.min(1, fraction)) * state.duration;
  set({ time: audio.currentTime });
}

export function setPreviewVolume(volume: number): void {
  const value = Math.max(0, Math.min(1, volume));
  if (audio) audio.volume = value;
  try {
    localStorage.setItem(VOLUME_KEY, String(value));
  } catch {
    // Not remembered; still applies now.
  }
  set({ volume: value });
}

export function usePreview(): PreviewState {
  const [value, setValue] = useState(state);
  useEffect(() => {
    const update = () => setValue(state);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return value;
}

/** True while this set's preview is the current one and playing. */
export function usePreviewPlaying(setId: number | null): boolean {
  const preview = usePreview();
  return setId != null && preview.setId === setId && preview.playing;
}
