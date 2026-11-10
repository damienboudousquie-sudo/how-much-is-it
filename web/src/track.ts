import { currentLang } from "./i18n";

let sentFirst = false;

function post(url: string, payload: unknown): void {
  try {
    void fetch(url, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", "x-lang": currentLang() },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  } catch {
    // Stats never get in the way.
  }
}

function campaign(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("utm_source") ?? params.get("ref") ?? "";
}

/** Counts a page view (no cookie, nothing stored in the browser, no personal data; see server/src/stats.ts). */
export function trackView(path: string): void {
  // Drop the "seen before" flag older versions left behind.
  try {
    localStorage.removeItem("osu-pp-lookup:seen");
  } catch {
    // ignore
  }
  const first = !sentFirst;
  sentFirst = true;
  const send = () => {
    const payload: Record<string, unknown> = { path, w: window.screen?.width ?? window.innerWidth, bl: navigator.language };
    // The map's name, once its page has set the title.
    if (/\/b\/\d+/.test(path)) payload.title = document.title.replace(/\s*·\s*how much is it \?\s*$/, "");
    if (first) {
      payload.ref = document.referrer;
      payload.utm = campaign();
      const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav && nav.loadEventEnd > 0) payload.load = Math.round(nav.loadEventEnd);
      else if (nav && nav.domContentLoadedEventEnd > 0) payload.load = Math.round(nav.domContentLoadedEventEnd);
    }
    post("/api/hit", payload);
  };
  if (/\/b\/\d+/.test(path)) window.setTimeout(send, 2500);
  else send();
}

/** Counts a feature being used (preview played, map pinned…): a name only. */
export function trackEvent(name: string): void {
  post("/api/event", { name });
}

// Time on the site: visible time, sent when the page is hidden or left.
let visibleSince = typeof document !== "undefined" && document.visibilityState === "visible" ? Date.now() : 0;
if (typeof document !== "undefined") {
  const report = () => {
    if (!visibleSince) return;
    const seconds = Math.round((Date.now() - visibleSince) / 1000);
    visibleSince = 0;
    if (seconds < 1 || !sentFirst) return;
    try {
      navigator.sendBeacon?.("/api/leave", JSON.stringify({ seconds }));
    } catch {
      // Not counted.
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") report();
    else visibleSince = Date.now();
  });
  window.addEventListener("pagehide", report);
}
