import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MapMark, TopPlay, UserProfile } from "@osu-pp/shared";
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
  if (!response.ok) throw new AppError("login_failed", "osu! refused the sign-in. Try again.", 401);
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
  if (!response.ok) throw new AppError("unavailable", "osu! did not answer. Try again.", 502);
  return (await response.json()) as T;
}

interface ApiUser {
  id: number;
  username: string;
  avatar_url?: string;
  country_code?: string;
  statistics?: { pp?: number; global_rank?: number | null };
}

function toProfile(user: ApiUser): UserProfile {
  return {
    id: user.id,
    username: user.username,
    avatarUrl: user.avatar_url ?? null,
    country: user.country_code ?? null,
    pp: user.statistics?.pp ?? null,
    rank: user.statistics?.global_rank ?? null,
  };
}

/** Finishes the sign-in. Returns the new session id, to put in the cookie. */
export async function completeLogin(code: string, state: string): Promise<string> {
  const at = pendingStates.get(state);
  pendingStates.delete(state);
  if (!at || Date.now() - at > STATE_TTL_MS) throw new AppError("login_failed", "This sign-in link expired. Try again.", 400);
  const token = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl() });
  const me = await apiGet<ApiUser>("/me/osu", token.access_token);
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
  beatmap?: { id: number };
}

async function refreshTop(sessionId: string, session: Session, file: PlayerFile): Promise<void> {
  if (Date.now() - file.topAt < TOP_TTL_MS) return;
  const access = await freshToken(sessionId, session);
  const [me, scores] = await Promise.all([
    apiGet<ApiUser>("/me/osu", access),
    apiGet<ApiScore[]>(`/users/${session.userId}/scores/best?mode=osu&limit=100`, access),
  ]);
  file.profile = toProfile(me);
  file.top = scores
    .filter((score) => score.beatmap?.id && typeof score.pp === "number")
    .map((score) => ({
      beatmapId: score.beatmap!.id,
      pp: Math.round(score.pp! * 100) / 100,
      accuracy: typeof score.accuracy === "number" ? Math.round(score.accuracy * 10000) / 100 : null,
      mods: (score.mods ?? []).map((mod) => (typeof mod === "string" ? mod : mod.acronym)).filter((mod) => mod !== "CL"),
    }));
  file.topAt = Date.now();
  await savePlayer(session.userId, file);
}

export interface MeAnswer {
  signedIn: boolean;
  loginAvailable: boolean;
  profile: UserProfile | null;
  marks: Record<string, MapMark>;
  top: TopPlay[];
}

export async function me(sessionId: string | undefined): Promise<MeAnswer> {
  const session = sessionFor(sessionId);
  if (!session || !sessionId) return { signedIn: false, loginAvailable: loginConfigured(), profile: null, marks: {}, top: [] };
  const file = loadPlayer(session.userId);
  if (!file) {
    logout(sessionId);
    return { signedIn: false, loginAvailable: loginConfigured(), profile: null, marks: {}, top: [] };
  }
  try {
    await refreshTop(sessionId, session, file);
  } catch (error) {
    if (error instanceof AppError && error.code === "signed_out") {
      return { signedIn: false, loginAvailable: loginConfigured(), profile: null, marks: {}, top: [] };
    }
    // osu! down: answer with what is stored.
  }
  return { signedIn: true, loginAvailable: true, profile: file.profile, marks: file.marks, top: file.top };
}

function requirePlayer(sessionId: string | undefined): { session: Session; file: PlayerFile } {
  const session = sessionFor(sessionId);
  const file = session ? loadPlayer(session.userId) : null;
  if (!session || !file) throw new AppError("signed_out", "Sign in with osu! first.", 401);
  return { session, file };
}

/** Sets (or clears, with null) the marks of a few maps. */
export async function setMarks(sessionId: string | undefined, changes: Record<string, MapMark | null>): Promise<Record<string, MapMark>> {
  const { session, file } = requirePlayer(sessionId);
  for (const [id, mark] of Object.entries(changes)) {
    if (!/^\d{1,10}$/.test(id)) continue;
    if (mark === null) delete file.marks[id];
    else if (mark === "farm" || mark === "done") file.marks[id] = mark;
  }
  const ids = Object.keys(file.marks);
  if (ids.length > MAX_MARKS) for (const id of ids.slice(0, ids.length - MAX_MARKS)) delete file.marks[id];
  await savePlayer(session.userId, file);
  return file.marks;
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
