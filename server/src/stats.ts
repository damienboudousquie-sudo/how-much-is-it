import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StatsResponse } from "@osu-pp/shared";
import { repoRoot } from "./env";

/**
 * Visit counts for the owner's stats page. No cookie and no IP is stored: a visitor is a
 * hash of IP + browser with a salt that changes every day, so a person can be counted
 * once per day but never followed from one day to the next. The country comes from the
 * Cloudflare header.
 */

const DIR = join(repoRoot, "cache", "stats");
const BOTS = /bot|crawl|spider|slurp|preview|fetch|monitor|uptime|curl|wget|python|headless|lighthouse|facebookexternalhit|discordbot|telegram/i;
const ACTIVE_MS = 5 * 60 * 1000;

interface Day {
  views: number;
  visitors: string[];
  countries: Record<string, number>;
  sources: Record<string, number>;
  pages: Record<string, number>;
  langs: Record<string, number>;
  signedIn: number;
}

const days = new Map<string, Day>();
const seen = new Map<string, Set<string>>();
const dirty = new Set<string>();
const active = new Map<string, number>();
let salt = { day: "", value: "" };

const today = () => new Date().toISOString().slice(0, 10);

function emptyDay(): Day {
  return { views: 0, visitors: [], countries: {}, sources: {}, pages: {}, langs: {}, signedIn: 0 };
}

async function load(day: string): Promise<Day> {
  let data = days.get(day);
  if (data) return data;
  try {
    data = { ...emptyDay(), ...(JSON.parse(await readFile(join(DIR, `${day}.json`), "utf8")) as Day) };
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

const bump = (record: Record<string, number>, key: string) => {
  record[key] = (record[key] ?? 0) + 1;
};

/** Short page kind from the hash route: maps, beatmap, pinned, foryou… */
function pageOf(path: unknown): string {
  const hash = typeof path === "string" ? path.replace(/^.*#\/?/, "") : "";
  const parts = hash.split("/").filter(Boolean);
  if (parts[1] === "b" || parts[0] === "b") return "beatmap";
  if (parts[1] === "maps") return `maps:${parts[0]}`;
  return (parts[0] ?? "maps").slice(0, 20) || "maps";
}

function sourceOf(referrer: unknown, ownHost: string): string | null {
  if (typeof referrer !== "string" || !referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (!host || host === ownHost.replace(/^www\./, "")) return null;
    return host.slice(0, 60);
  } catch {
    return null;
  }
}

export async function recordHit(input: {
  body: unknown;
  ip: string;
  userAgent: string;
  country: string | undefined;
  lang: string;
  host: string;
  signedIn: boolean;
}): Promise<void> {
  if (!input.userAgent || BOTS.test(input.userAgent)) return;
  const raw = (typeof input.body === "string" ? safeJson(input.body) : input.body) as { path?: unknown; ref?: unknown; first?: unknown } | null;
  const day = today();
  const data = await load(day);
  const visitor = createHash("sha256").update(`${await daySalt(day)}|${input.ip}|${input.userAgent}`).digest("hex").slice(0, 16);
  const set = seen.get(day)!;
  const country = /^[A-Z]{2}$/.test(input.country ?? "") && input.country !== "XX" ? input.country! : "??";
  data.views += 1;
  bump(data.pages, pageOf(raw?.path));
  if (!set.has(visitor)) {
    set.add(visitor);
    data.visitors.push(visitor);
    bump(data.countries, country);
    bump(data.langs, (input.lang || "?").slice(0, 5));
    if (input.signedIn) data.signedIn += 1;
    bump(data.sources, sourceOf(raw?.ref, input.host) ?? "direct");
  }
  active.set(visitor, Date.now());
  dirty.add(day);
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
    if (day !== today() && !dirty.has(day)) {
      days.delete(day);
      seen.delete(day);
    }
  }
}

setInterval(() => void flush().catch(() => undefined), 30_000).unref();
process.once("SIGTERM", () => void flush().finally(() => process.exit(0)));

const merge = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [key, value] of Object.entries(from)) into[key] = (into[key] ?? 0) + value;
};

const top = (record: Record<string, number>, count = 20) =>
  Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([key, value]) => ({ key, value }));

export async function readStats(span: number): Promise<StatsResponse> {
  await flush();
  const wanted = Math.max(1, Math.min(365, Math.round(span)));
  const files = new Set((await readdir(DIR).catch(() => [] as string[])).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)));
  const series: StatsResponse["days"] = [];
  const countries: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const pages: Record<string, number> = {};
  const langs: Record<string, number> = {};
  let views = 0;
  let visits = 0;
  let signedIn = 0;
  for (let back = wanted - 1; back >= 0; back--) {
    const day = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
    const data = days.get(day) ?? (files.has(`${day}.json`) ? await load(day) : null);
    const dayVisitors = data?.visitors.length ?? 0;
    series.push({ day, views: data?.views ?? 0, visitors: dayVisitors });
    if (!data) continue;
    views += data.views;
    visits += dayVisitors;
    signedIn += data.signedIn;
    merge(countries, data.countries);
    merge(sources, data.sources);
    merge(pages, data.pages);
    merge(langs, data.langs);
  }
  const now = Date.now();
  for (const [visitor, at] of active) if (now - at > ACTIVE_MS) active.delete(visitor);
  return {
    span: wanted,
    views,
    visits,
    signedIn,
    online: active.size,
    days: series,
    countries: top(countries, 40),
    sources: top(sources),
    pages: top(pages),
    langs: top(langs),
  };
}
