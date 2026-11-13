import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MAP_STYLES, type MapMark, type Mode, type PinInfo, type TopPlay, type UserProfile } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { AppError } from "./errors";

/**
 * Sign in with osu! (OAuth authorization code), sessions, and per-player data kept on
 * the server: map marks and a cached copy of the player's top plays.
 *
 * Needs an osu! OAuth application (osu.ppy.sh, Settings, OAuth) whose callback URL is
 * PUBLIC_URL + /api/auth/callback, with OSU_CLIENT_ID and OSU_CLIENT_SECRET in .env.
 */

const AUTHORIZE_URL = "https://osu.ppy.sh/oauth/authorize";
const TOKEN_URL = "https://osu.ppy.sh/oauth/token";
const API = "https://osu.ppy.sh/api/v2";
const DIR = join(repoRoot, "cache", "accounts");
const SESSIONS_FILE = join(DIR, "sessions.json");
export const SESSION_COOKIE = "hmi_session";
const SESSION_DAYS = 60;
const STATE_TTL_MS = 10 * 60 * 1000;
const TOP_TTL_MS = 10 * 60 * 1000;
const MAX_MARKS = 5000;

interface Session {
  userId: number;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  createdAt: number;
}

interface PlayerFile {
  profile: UserProfile;
  marks: Record<string, MapMark>;
  pins?: Record<string, PinInfo>;
  top: TopPlay[];
  topAt: number;
}

export function loginConfigured(): boolean {
  return Boolean(process.env.OSU_CLIENT_ID && process.env.OSU_CLIENT_SECRET && publicUrl());
}

function publicUrl(): string {
  const configured = process.env.PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const site = process.env.SITE_ADDRESS?.split(",")[0]?.trim();
  return site && !site.startsWith(":") ? `https://${site}` : "";
}

export function callbackUrl(): string {
  return `${publicUrl()}/api/auth/callback`;
}

/* ---------- storage ---------- */

let sessions: Map<string, Session> | null = null;
let sessionsTimer: NodeJS.Timeout | null = null;

function loadSessions(): Map<string, Session> {
  if (sessions) return sessions;
  sessions = new Map();
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Record<string, Session>;
    const cutoff = Date.now() - SESSION_DAYS * 86_400_000;
    for (const [id, session] of Object.entries(raw)) if (session.createdAt > cutoff) sessions.set(id, session);
  } catch {
    // First run.
  }
  return sessions;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, JSON.stringify(value));
  await rename(temp, file);
}

function saveSessions(): void {
  if (sessionsTimer) return;
  sessionsTimer = setTimeout(() => {
    sessionsTimer = null;
    void writeJson(SESSIONS_FILE, Object.fromEntries(loadSessions())).catch(() => undefined);
  }, 500);
}

const players = new Map<number, PlayerFile>();

function playerPath(userId: number): string {
  return join(DIR, `player-${userId}.json`);
}

function loadPlayer(userId: number): PlayerFile | null {
  const cached = players.get(userId);
  if (cached) return cached;
  try {
    const file = JSON.parse(readFileSync(playerPath(userId), "utf8")) as PlayerFile;
    players.set(userId, file);
    return file;
  } catch {
    return null;
  }
}

async function savePlayer(userId: number, file: PlayerFile): Promise<void> {
  players.set(userId, file);
  await writeJson(playerPath(userId), file);
}

/* ---------- OAuth ---------- */

const pendingStates = new Map<string, number>();

export function loginRedirect(): string {
  if (!loginConfigured()) throw new AppError("login_off", "Sign-in with osu! is not set up on this server.", 503);
  const now = Date.now();
  for (const [state, at] of pendingStates) if (now - at > STATE_TTL_MS) pendingStates.delete(state);
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, now);
  const params = new URLSearchParams({
    client_id: process.env.OSU_CLIENT_ID ?? "",
    redirect_uri: callbackUrl(),
    response_type: "code",
    scope: "identify public",
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

interface TokenAnswer {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenAnswer> {
  let response: Response;
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.OSU_CLIENT_ID ?? "",
        client_secret: process.env.OSU_CLIENT_SECRET ?? "",
        ...body,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError("unavailable", "osu! did not answer. Try again.", 502);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: string; message?: string; hint?: string; error_description?: string };
      detail = [body.error, body.error_description ?? body.message, body.hint].filter(Boolean).join(" - ");
    } catch {
      // No details.
    }
    throw new AppError("login_failed", `osu! refused the sign-in (HTTP ${response.status}${detail ? `: ${detail}` : ""}).`, 401);
  }
  return (await response.json()) as TokenAnswer;
}

async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "x-api-version": "20240529" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError("unavailable", "osu! did not answer. Try again.", 502);
  }
  if (response.status === 401) throw new AppError("signed_out", "Your osu! sign-in expired. Sign in again.", 401);
  if (!response.ok) throw new AppError("unavailable", `osu! answered HTTP ${response.status} to ${path}.`, 502);
  return (await response.json()) as T;
}

interface ApiUser {
  id: number;
  username: string;
  avatar_url?: string;
  country_code?: string;
  cover_url?: string;
  cover?: { url?: string | null; custom_url?: string | null };
  playmode?: string;
  statistics?: { pp?: number; global_rank?: number | null; country_rank?: number | null };
}

function toProfile(user: ApiUser): UserProfile {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatar_url ?? null,
    coverUrl: user.cover?.custom_url ?? user.cover?.url ?? user.cover_url ?? null,
    country: user.country_code ?? null,
    pp: user.statistics?.pp ?? null,
    rank: user.statistics?.global_rank ?? null,
    countryRank: user.statistics?.country_rank ?? null,
    mode: playMode(user.playmode),
  };
}

/** The player's main mode as osu! names it (osu, taiko, fruits, mania). */
function playMode(value: string | undefined): Mode {
  return value === "taiko" ? "taiko" : value === "fruits" ? "catch" : value === "mania" ? "mania" : "osu";
}

/** The mode name in osu! API paths. */
function pathMode(mode: Mode): string {
  return mode === "catch" ? "fruits" : mode;
}

/** Finishes the sign-in. Returns the new session id, to put in the cookie. */
export async function completeLogin(code: string, state: string): Promise<string> {
  const at = pendingStates.get(state);
  pendingStates.delete(state);
  if (!at || Date.now() - at > STATE_TTL_MS) throw new AppError("login_failed", "This sign-in link expired. Try again.", 400);
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl() });
  // No mode in the path: osu! answers with the player's main mode (and its stats).
  const me = await apiGet<ApiUser>("/me", token.access_token);
  const id = randomBytes(24).toString("base64url");
  loadSessions().set(id, {
    userId: me.id,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    createdAt: Date.now(),
  });
  saveSessions();
  const existing = loadPlayer(me.id);
  await savePlayer(me.id, {
    profile: toProfile(me),
    marks: existing?.marks ?? {},
    pins: existing?.pins ?? {},
    top: existing?.top ?? [],
    topAt: 0,
  });
  return id;
}

export function logout(sessionId: string | undefined): void {
  if (sessionId && loadSessions().delete(sessionId)) saveSessions();
}

async function freshToken(sessionId: string, session: Session): Promise<string> {
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
  try {
    const token = await tokenRequest({ grant_type: "refresh_token", refresh_token: session.refreshToken });
    session.accessToken = token.access_token;
    session.refreshToken = token.refresh_token;
    session.expiresAt = Date.now() + token.expires_in * 1000;
    saveSessions();
    return session.accessToken;
  } catch (error) {
    logout(sessionId);
    throw error instanceof AppError && error.code === "unavailable"
      ? error
      : new AppError("signed_out", "Your osu! sign-in expired. Sign in again.", 401);
  }
}

function sessionFor(sessionId: string | undefined): Session | null {
  if (!sessionId) return null;
  return loadSessions().get(sessionId) ?? null;
}

/* ---------- player data ---------- */

interface ApiScore {
  pp?: number | null;
  accuracy?: number;
  mods?: ({ acronym: string } | string)[];
  beatmap?: { id: number; version?: string; difficulty_rating?: number };
  beatmapset?: { id?: number; title?: string; artist?: string };
  max_combo?: number;
  statistics?: { great?: number; ok?: number; meh?: number; miss?: number; count_300?: number; count_100?: number; count_50?: number; count_miss?: number };
}

async function refreshTop(sessionId: string, session: Session, file: PlayerFile): Promise<void> {
  // Saves from before score details were kept (no misses field) are fetched again at once.
  const detailed = (file.top.length === 0 || file.top[0].misses !== undefined) && file.profile?.coverUrl !== undefined && file.profile?.mode !== undefined;
  if (detailed && Date.now() - file.topAt < TOP_TTL_MS) return;
  const access = await freshToken(sessionId, session);
  // The player's main mode first, then the top plays of that mode.
  const me = await apiGet<ApiUser>("/me", access);
  const mode = playMode(me.playmode);
  const scores = await apiGet<ApiScore[]>(`/users/${session.userId}/scores/best?mode=${pathMode(mode)}&limit=100`, access);
  file.profile = toProfile(me);
  file.top = scores
    .filter((score) => score.beatmap?.id && typeof score.pp === "number")
    .map((score) => {
      const acronyms = (score.mods ?? []).map((mod) => (typeof mod === "string" ? mod : mod.acronym));
      const stats = score.statistics ?? {};
      return {
        beatmapId: score.beatmap!.id,
        pp: Math.round(score.pp! * 100) / 100,
        accuracy: typeof score.accuracy === "number" ? Math.round(score.accuracy * 10000) / 100 : null,
        mods: acronyms.filter((mod) => mod !== "CL"),
        misses: stats.miss ?? stats.count_miss ?? 0,
        combo: typeof score.max_combo === "number" ? score.max_combo : undefined,
        n300: stats.great ?? stats.count_300,
        n100: stats.ok ?? stats.count_100,
        n50: stats.meh ?? stats.count_50,
        classic: acronyms.includes("CL"),
        title: score.beatmapset?.title,
        artist: score.beatmapset?.artist,
        version: score.beatmap?.version,
        setId: score.beatmapset?.id,
        stars: typeof score.beatmap?.difficulty_rating === "number" ? Math.round(score.beatmap.difficulty_rating * 100) / 100 : undefined,
      };
    });
  file.topAt = Date.now();
  await savePlayer(session.userId, file);
}

export interface MeAnswer {
  signedIn: boolean;
  loginAvailable: boolean;
  profile: UserProfile | null;
  marks: Record<string, MapMark>;
  pins: Record<string, PinInfo>;
  top: TopPlay[];
  admin: boolean;
}

/**
 * osu! account ids allowed to read the feedback: the site owner (TYROOOO, 18188835) by
 * default. Ids, not names: a name can change hands, an id never does.
 */
function admins(): Set<number> {
  return new Set(
    (process.env.ADMIN_OSU_IDS ?? "18188835")
      .split(",")
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
  );
}

export function isAdmin(profile: UserProfile | null): boolean {
  return profile != null && admins().has(profile.id);
}

/** The signed-in player, without calling osu!. */
export function currentUser(sessionId: string | undefined): UserProfile | null {
  const session = sessionFor(sessionId);
  return session ? (loadPlayer(session.userId)?.profile ?? null) : null;
}

const SIGNED_OUT = (): MeAnswer => ({ signedIn: false, loginAvailable: loginConfigured(), profile: null, marks: {}, pins: {}, top: [], admin: false });

export async function me(sessionId: string | undefined): Promise<MeAnswer> {
  const session = sessionFor(sessionId);
  if (!session || !sessionId) return SIGNED_OUT();
  const file = loadPlayer(session.userId);
  if (!file) {
    logout(sessionId);
    return SIGNED_OUT();
  }
  try {
    await refreshTop(sessionId, session, file);
  } catch (error) {
    if (error instanceof AppError && error.code === "signed_out") {
      return SIGNED_OUT();
    }
    // osu! down: answer with what is stored.
  }
  return { signedIn: true, loginAvailable: true, profile: file.profile, marks: file.marks, pins: file.pins ?? {}, top: file.top, admin: isAdmin(file.profile) };
}

/** The signed-in player's top plays and marks, for recommendations. */
export function playerData(sessionId: string | undefined): { top: TopPlay[]; marks: Record<string, MapMark>; mode: Mode } {
  const { file } = requirePlayer(sessionId);
  return { top: file.top, marks: file.marks, mode: file.profile.mode ?? "osu" };
}

function requirePlayer(sessionId: string | undefined): { session: Session; file: PlayerFile } {
  const session = sessionFor(sessionId);
  const file = session ? loadPlayer(session.userId) : null;
  if (!session || !file) throw new AppError("signed_out", "Sign in with osu! first.", 401);
  return { session, file };
}

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const STYLE_NAMES = new Set<string>(MAP_STYLES.filter((style) => style !== "any"));

/** Keeps only the expected fields of a pin sent by the browser. */
function cleanPin(id: number, raw: unknown): PinInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const pin = raw as Record<string, unknown>;
  const mode = pin.mode === "taiko" || pin.mode === "catch" || pin.mode === "mania" ? pin.mode : "osu";
  const cover = text(pin.cover, 300);
  const style = typeof pin.style === "string" && STYLE_NAMES.has(pin.style) ? (pin.style as PinInfo["style"]) : null;
  return {
    beatmapId: id,
    beatmapsetId: num(pin.beatmapsetId),
    mode,
    title: text(pin.title),
    artist: text(pin.artist),
    version: text(pin.version),
    creator: text(pin.creator, 60),
    cover: /^https:\/\/assets\.ppy\.sh\//.test(cover) ? cover : null,
    stars: num(pin.stars) ?? 0,
    pp: num(pin.pp) ?? 0,
    mods: Array.isArray(pin.mods) ? pin.mods.filter((mod): mod is string => typeof mod === "string" && /^[A-Z]{2}$/.test(mod)).slice(0, 8) : [],
    lengthSeconds: num(pin.lengthSeconds),
    bpm: num(pin.bpm),
    ar: num(pin.ar),
    style,
    tags: Array.isArray(pin.tags) ? (pin.tags.filter((tag) => typeof tag === "string" && STYLE_NAMES.has(tag)) as PinInfo["tags"]).slice(0, 6) : [],
    at: num(pin.at) ?? Date.now(),
  };
}

/** Sets (or clears, with null) the marks of a few maps, with what each pinned map looks like. */
export async function setMarks(
  sessionId: string | undefined,
  changes: Record<string, MapMark | null>,
  pins: Record<string, unknown> = {},
): Promise<{ marks: Record<string, MapMark>; pins: Record<string, PinInfo> }> {
  const { session, file } = requirePlayer(sessionId);
  file.pins ??= {};
  for (const [id, mark] of Object.entries(changes)) {
    if (!/^\d{1,10}$/.test(id)) continue;
    if (mark === null) {
      delete file.marks[id];
      delete file.pins[id];
    } else if (mark === "farm" || mark === "done") {
      file.marks[id] = mark;
      const pin = cleanPin(Number(id), pins[id]);
      if (pin) file.pins[id] = { ...pin, at: file.pins[id]?.at ?? pin.at };
    }
  }
  const ids = Object.keys(file.marks);
  if (ids.length > MAX_MARKS) {
    for (const id of ids.slice(0, ids.length - MAX_MARKS)) {
      delete file.marks[id];
      delete file.pins[id];
    }
  }
  await savePlayer(session.userId, file);
  return { marks: file.marks, pins: file.pins };
}

/** Reads the session cookie from a Cookie header. */
export function sessionFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  const secure = publicUrl().startsWith("https://") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;

/** Short-lived, readable by the page: why the last sign-in failed. */
export function loginErrorCookie(message: string): string {
  const secure = publicUrl().startsWith("https://") ? "; Secure" : "";
  return `hmi_login_error=${encodeURIComponent(message.slice(0, 300))}; Path=/; SameSite=Lax; Max-Age=120${secure}`;
}
