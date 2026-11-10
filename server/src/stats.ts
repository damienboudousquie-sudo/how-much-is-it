import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StatsCount, StatsResponse } from "@osu-pp/shared";
import { repoRoot } from "./env";

/**
 * Visit counts for the owner's stats page. No cookie and no IP is stored: a visitor is a
 * hash of IP + browser with a salt that changes every day, so a person can be counted
 * once per day but never followed from one day to the next. Nothing is stored in the
 * browser for stats. The country comes from the Cloudflare header.
 */

const DIR = join(repoRoot, "cache", "stats");
const BOTS = /bot|crawl|spider|slurp|preview|fetch|monitor|uptime|curl|wget|python|headless|lighthouse|facebookexternalhit|discordbot|telegram|whatsapp|embedly|quora|pinterest|vkshare|w3c_validator/i;
const ACTIVE_MS = 5 * 60 * 1000;
const TIME_ZONE = "Europe/Paris";
const EVENTS = new Set([
  "search",
  "map_open",
  "preview_play",
  "auto_open",
  "pin_farm",
  "pin_done",
  "pin_clear",
  "login_click",
  "feedback_open",
  "feedback_sent",
  "lang_change",
  "foryou_refresh",
  "mode_change",
  "style_filter",
  "mod_filter",
]);

interface Day {
  views: number;
  visitors: string[];
  /** Pages seen per visitor (hash), for bounce rate and pages per visit. */
  perVisitor: Record<string, number>;
  /** Seconds spent on the site per visitor (hash), reported when the page is left. */
  seconds: Record<string, number>;
  countries: Record<string, number>;
  sources: Record<string, number>;
  referrers: Record<string, number>;
  campaigns: Record<string, number>;
  pages: Record<string, number>;
  langs: Record<string, number>;
  browserLangs: Record<string, number>;
  browsers: Record<string, number>;
  systems: Record<string, number>;
  devices: Record<string, number>;
  screens: Record<string, number>;
  hours: number[];
  signedIn: number;
  maps: Record<string, { title: string; n: number }>;
  events: Record<string, number>;
  loadMs: { sum: number; n: number };
}

const days = new Map<string, Day>();
const seen = new Map<string, Set<string>>();
const dirty = new Set<string>();
const active = new Map<string, { at: number; page: string }>();
let salt = { day: "", value: "" };

const dayOf = (at = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(at);
const hourOf = (at = Date.now()) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", hourCycle: "h23" }).format(at));

function emptyDay(): Day {
  return {
    views: 0,
    visitors: [],
    perVisitor: {},
    seconds: {},
    countries: {},
    sources: {},
    referrers: {},
    campaigns: {},
    pages: {},
    langs: {},
    browserLangs: {},
    browsers: {},
    systems: {},
    devices: {},
    screens: {},
    hours: Array(24).fill(0),
    signedIn: 0,
    maps: {},
    events: {},
    loadMs: { sum: 0, n: 0 },
  };
}

async function load(day: string): Promise<Day> {
  let data = days.get(day);
  if (data) return data;
  try {
    const saved = JSON.parse(await readFile(join(DIR, `${day}.json`), "utf8")) as Partial<Day>;
    data = { ...emptyDay(), ...saved };
    if (!Array.isArray(data.hours) || data.hours.length !== 24) data.hours = Array(24).fill(0);
  } catch {
    data = emptyDay();
  }
  days.set(day, data);
  seen.set(day, new Set(data.visitors));
  return data;
}

async function daySalt(day: string): Promise<string> {
  if (salt.day === day) return salt.value;
  const file = join(DIR, "salt.json");
  try {
    const saved = JSON.parse(await readFile(file, "utf8")) as { day: string; value: string };
    if (saved.day === day) {
      salt = saved;
      return salt.value;
    }
  } catch {
    // New salt below.
  }
  // Yesterday's salt is thrown away: old hashes can no longer be matched to anyone.
  salt = { day, value: randomBytes(16).toString("hex") };
  await mkdir(DIR, { recursive: true });
  await writeFile(file, JSON.stringify(salt));
  return salt.value;
}

const bump = (record: Record<string, number>, key: string, by = 1) => {
  record[key] = (record[key] ?? 0) + by;
};

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "");

/** Short page kind from the hash route: maps:osu, beatmap, pinned, foryou… */
function pageOf(path: string): string {
  const hash = path.replace(/^.*#\/?/, "");
  const parts = hash.split("/").filter(Boolean);
  if (parts[1] === "b" || parts[0] === "b") return "beatmap";
  if (parts[1] === "maps") return `maps:${parts[0]}`;
  return (parts[0] ?? "maps").slice(0, 20) || "maps";
}

function beatmapOf(path: string): string | null {
  const match = path.match(/#\/?\w+\/b\/(\d{1,10})/);
  return match ? match[1] : null;
}

function sourceOf(referrer: string, ownHost: string): { host: string; page: string } | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    const host = url.hostname.replace(/^www\./, "");
    if (!host || host === ownHost.replace(/^www\./, "").split(":")[0]) return null;
    return { host: host.slice(0, 60), page: `${host}${url.pathname}`.replace(/\/$/, "").slice(0, 120) };
  } catch {
    return null;
  }
}

function browserOf(ua: string): string {
  if (/OPR\/|Opera|OPT\//.test(ua)) return "Opera";
  if (/Edg\//.test(ua)) return "Edge";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/YaBrowser/.test(ua)) return "Yandex";
  if (/Vivaldi/.test(ua)) return "Vivaldi";
  if (/Firefox|FxiOS/.test(ua)) return "Firefox";
  if (/Chrome|CriOS|Chromium/.test(ua)) return "Chrome";
  if (/Safari/.test(ua)) return "Safari";
  return "Other";
}

function systemOf(ua: string): string {
  if (/Windows/.test(ua)) return "Windows";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

function deviceOf(ua: string, width: number): string {
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return "tablet";
  if (/Mobi|iPhone|Android/.test(ua)) return "mobile";
  if (width > 0 && width < 760) return "mobile";
  return "desktop";
}

function screenOf(width: number): string {
  if (!width) return "?";
  if (width < 480) return "< 480";
  if (width < 768) return "480–767";
  if (width < 1024) return "768–1023";
  if (width < 1440) return "1024–1439";
  if (width < 1920) return "1440–1919";
  if (width < 2560) return "1920–2559";
  return "≥ 2560";
}

interface HitInput {
  body: unknown;
  ip: string;
  userAgent: string;
  country: string | undefined;
  lang: string;
  host: string;
  signedIn: boolean;
}

function parse(body: unknown): Record<string, unknown> {
  if (typeof body === "string") {
    try {
      return (JSON.parse(body) as Record<string, unknown>) ?? {};
    } catch {
      return {};
    }
  }
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

async function visitorOf(input: HitInput, day: string): Promise<string> {
  return createHash("sha256").update(`${await daySalt(day)}|${input.ip}|${input.userAgent}`).digest("hex").slice(0, 16);
}

/** A page shown. The first page of a visit also carries where the visitor came from. */
export async function recordHit(input: HitInput): Promise<void> {
  if (!input.userAgent || BOTS.test(input.userAgent)) return;
  const raw = parse(input.body);
  const day = dayOf();
  const data = await load(day);
  const visitor = await visitorOf(input, day);
  const set = seen.get(day)!;
  const path = text(raw.path, 200);
  const page = pageOf(path);
  const width = Math.max(0, Math.min(10000, Number(raw.w) || 0));

  data.views += 1;
  bump(data.pages, page);
  data.perVisitor[visitor] = (data.perVisitor[visitor] ?? 0) + 1;
  const map = beatmapOf(path);
  if (map) {
    const entry = (data.maps[map] ??= { title: "", n: 0 });
    entry.n += 1;
    const title = text(raw.title, 120);
    if (title) entry.title = title;
  }

  if (!set.has(visitor)) {
    set.add(visitor);
    data.visitors.push(visitor);
    const country = /^[A-Z]{2}$/.test(input.country ?? "") && input.country !== "XX" && input.country !== "T1" ? input.country! : "??";
    const ua = input.userAgent;
    bump(data.countries, country);
    bump(data.langs, (input.lang || "?").slice(0, 5));
    bump(data.browserLangs, text(raw.bl, 12).toLowerCase().split("-")[0] || "?");
    bump(data.browsers, browserOf(ua));
    bump(data.systems, systemOf(ua));
    bump(data.devices, deviceOf(ua, width));
    bump(data.screens, screenOf(width));
    data.hours[hourOf()] += 1;
    if (input.signedIn) data.signedIn += 1;
    const source = sourceOf(text(raw.ref, 300), input.host);
    bump(data.sources, source?.host ?? "direct");
    if (source) bump(data.referrers, source.page);
    const campaign = text(raw.utm, 60);
    if (campaign) bump(data.campaigns, campaign.toLowerCase());
    const load = Number(raw.load);
    if (Number.isFinite(load) && load > 0 && load < 60000) {
      data.loadMs.sum += load;
      data.loadMs.n += 1;
    }
  }
  active.set(visitor, { at: Date.now(), page });
  dirty.add(day);
}

/** Time spent: the browser reports how long the page was visible when it is left. */
export async function recordLeave(input: HitInput): Promise<void> {
  if (!input.userAgent || BOTS.test(input.userAgent)) return;
  const raw = parse(input.body);
  const secondsSpent = Math.round(Number(raw.seconds));
  if (!Number.isFinite(secondsSpent) || secondsSpent <= 0) return;
  const day = dayOf();
  const data = await load(day);
  const visitor = await visitorOf(input, day);
  if (!seen.get(day)?.has(visitor)) return;
  data.seconds[visitor] = Math.min(6 * 3600, (data.seconds[visitor] ?? 0) + Math.min(secondsSpent, 3600));
  active.delete(visitor);
  dirty.add(day);
}

/** Something done on the site (preview played, map pinned…): only a counter per day. */
export async function recordEvent(input: HitInput): Promise<void> {
  if (!input.userAgent || BOTS.test(input.userAgent)) return;
  const name = text(parse(input.body).name, 30);
  if (!EVENTS.has(name)) return;
  const day = dayOf();
  const data = await load(day);
  bump(data.events, name);
  dirty.add(day);
}

async function flush(): Promise<void> {
  if (dirty.size === 0) return;
  await mkdir(DIR, { recursive: true });
  for (const day of [...dirty]) {
    dirty.delete(day);
    const data = days.get(day);
    if (!data) continue;
    const file = join(DIR, `${day}.json`);
    await writeFile(`${file}.tmp`, JSON.stringify(data));
    await rename(`${file}.tmp`, file);
  }
  // Only today stays in memory.
  for (const day of days.keys()) {
    if (day !== dayOf() && !dirty.has(day)) {
      days.delete(day);
      seen.delete(day);
    }
  }
}

setInterval(() => void flush().catch(() => undefined), 30_000).unref();
process.once("SIGTERM", () => void flush().finally(() => process.exit(0)));

const merge = (into: Record<string, number>, from: Record<string, number> | undefined) => {
  for (const [key, value] of Object.entries(from ?? {})) into[key] = (into[key] ?? 0) + value;
};

const top = (record: Record<string, number>, count = 20): StatsCount[] =>
  Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, value]) => ({ key, value }));

interface Totals {
  views: number;
  visits: number;
  bounces: number;
  seconds: number;
  timed: number;
}

async function readDay(day: string, files: Set<string>): Promise<Day | null> {
  return days.get(day) ?? (files.has(`${day}.json`) ? await load(day) : null);
}

function totalsOf(data: Day | null, into: Totals): void {
  if (!data) return;
  into.views += data.views;
  into.visits += data.visitors.length;
  for (const visitor of data.visitors) if ((data.perVisitor[visitor] ?? 0) <= 1) into.bounces += 1;
  for (const value of Object.values(data.seconds)) {
    into.seconds += value;
    into.timed += 1;
  }
}

export async function readStats(span: number): Promise<StatsResponse> {
  await flush();
  const wanted = Math.max(1, Math.min(365, Math.round(span)));
  const files = new Set((await readdir(DIR).catch(() => [] as string[])).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)));
  const series: StatsResponse["days"] = [];
  const sum = {
    countries: {} as Record<string, number>,
    sources: {} as Record<string, number>,
    referrers: {} as Record<string, number>,
    campaigns: {} as Record<string, number>,
    pages: {} as Record<string, number>,
    langs: {} as Record<string, number>,
    browserLangs: {} as Record<string, number>,
    browsers: {} as Record<string, number>,
    systems: {} as Record<string, number>,
    devices: {} as Record<string, number>,
    screens: {} as Record<string, number>,
    events: {} as Record<string, number>,
  };
  const maps: Record<string, { title: string; n: number }> = {};
  const hours: number[] = Array(24).fill(0);
  const weekdays: number[] = Array(7).fill(0);
  const now: Totals = { views: 0, visits: 0, bounces: 0, seconds: 0, timed: 0 };
  const before: Totals = { views: 0, visits: 0, bounces: 0, seconds: 0, timed: 0 };
  let signedIn = 0;
  let load = { sum: 0, n: 0 };

  for (let back = wanted - 1; back >= 0; back--) {
    const at = Date.now() - back * 86_400_000;
    const day = dayOf(at);
    const data = await readDay(day, files);
    series.push({ day, views: data?.views ?? 0, visitors: data?.visitors.length ?? 0 });
    if (!data) continue;
    totalsOf(data, now);
    signedIn += data.signedIn;
    load = { sum: load.sum + data.loadMs.sum, n: load.n + data.loadMs.n };
    for (const key of Object.keys(sum) as (keyof typeof sum)[]) merge(sum[key], data[key]);
    for (const [id, entry] of Object.entries(data.maps)) {
      const into = (maps[id] ??= { title: "", n: 0 });
      into.n += entry.n;
      if (entry.title) into.title = entry.title;
    }
    data.hours.forEach((value, hour) => (hours[hour] += value));
    weekdays[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7] += data.visitors.length;
  }
  // The period before, to compare.
  for (let back = 2 * wanted - 1; back >= wanted; back--) totalsOf(await readDay(dayOf(Date.now() - back * 86_400_000), files), before);

  const cutoff = Date.now() - ACTIVE_MS;
  const online: Record<string, number> = {};
  for (const [visitor, entry] of active) {
    if (entry.at < cutoff) active.delete(visitor);
    else bump(online, entry.page);
  }

  const rates = (totals: Totals) => ({
    views: totals.views,
    visits: totals.visits,
    bounceRate: totals.visits ? totals.bounces / totals.visits : 0,
    pagesPerVisit: totals.visits ? totals.views / totals.visits : 0,
    avgSeconds: totals.timed ? totals.seconds / totals.timed : 0,
  });

  return {
    span: wanted,
    ...rates(now),
    previous: rates(before),
    signedIn,
    online: active.size,
    onlinePages: top(online, 10),
    avgLoadMs: load.n ? load.sum / load.n : 0,
    days: series,
    hours,
    weekdays,
    countries: top(sum.countries, 60),
    sources: top(sum.sources),
    referrers: top(sum.referrers),
    campaigns: top(sum.campaigns),
    pages: top(sum.pages),
    langs: top(sum.langs),
    browserLangs: top(sum.browserLangs),
    browsers: top(sum.browsers),
    systems: top(sum.systems),
    devices: top(sum.devices),
    screens: top(sum.screens),
    events: top(sum.events, 30),
    maps: Object.entries(maps)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 20)
      .map(([id, entry]) => ({ id: Number(id), title: entry.title, value: entry.n })),
  };
}
