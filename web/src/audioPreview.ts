import { useEffect, useState } from "react";

/** The 10 s preview clip osu! serves for every beatmapset. */
export function previewUrl(setId: number): string {
  return `https://b.ppy.sh/preview/${setId}.mp3`;
}

let audio: HTMLAudioElement | null = null;
let current: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Stops whatever preview is playing, e.g. when the auto player starts its own music. */
export function stopPreview(): void {
  if (audio) audio.pause();
  audio = null;
  current = null;
  emit();
}

/** Plays a set's preview, or stops it if it is the one playing. Only one plays at a time. */
export function togglePreview(setId: number): void {
  if (current === setId) {
    stopPreview();
    return;
  }
  stopPreview();
  const next = new Audio(previewUrl(setId));
  next.volume = 0.45;
  next.addEventListener("ended", () => {
    if (audio === next) stopPreview();
  });
  next.addEventListener("error", () => {
    if (audio === next) stopPreview();
  });
  audio = next;
  current = setId;
  emit();
  void next.play().catch(() => {
    if (audio === next) stopPreview();
  });
}

/** True while this set's preview is playing. */
export function usePreviewPlaying(setId: number | null): boolean {
  const [playing, setPlaying] = useState(setId != null && current === setId);
  useEffect(() => {
    const update = () => setPlaying(setId != null && current === setId);
    listeners.add(update);
    update();
    return () => {
      listeners.delete(update);
    };
  }, [setId]);
  return playing;
}
