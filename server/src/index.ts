import "./env";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { apiKeyConfigured, mirrorHealth, rankForPp } from "./osuApi";
import { InputError } from "@osu-pp/shared";
import { parseCalculate, parseDiscover, parseLookup } from "./body";
import { host, port, repoRoot } from "./env";
import { AppError } from "./errors";
import { currentUser, isAdmin } from "./account";
import { addFeedback, deleteFeedback, listFeedback, updateFeedback } from "./feedback";
import { completeLogin, loginErrorCookie, loginRedirect, logout, me, SESSION_MAX_AGE, sessionCookie, sessionFromCookie, setMarks } from "./account";
import { bindLang, tr } from "./locale";
import { exportPacked } from "./patternStore";
import { fetchBeatmapText } from "./beatmapCache";
import { mapAudio } from "./audio";
import { recommend } from "./recommend";
import { avatarBytes, coverBytes, profileInsights } from "./profile";
import { readStats, recordEvent, recordHit, recordLeave } from "./stats";
import { catalogHealth, startCatalogueWarmer, warmerStatus } from "./ppDb";
import { scanStatus, startFullScan } from "./scan";
import { calculate, discover, lookup, prefetch, search, warmFinderIndex, type Timing } from "./service";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, disableRequestLogging: true });

await app.register(cors, { origin: true });

app.addHook("onRequest", (request, _reply, done) => {
  bindLang(request.headers["x-lang"]);
  done();
});

/** JSON answers (a page of maps is ~30 KB) are compressed; files are served pre-compressed. */
app.addHook("onSend", async (request, reply, payload) => {
  if (typeof payload !== "string" || payload.length < 1024) return payload;
  if (!String(reply.getHeader("content-type") ?? "").includes("application/json")) return payload;
  const accepts = String(request.headers["accept-encoding"] ?? "");
  reply.header("vary", "accept-encoding");
  if (/\bbr\b/.test(accepts)) {
    reply.header("content-encoding", "br");
    return brotliCompressSync(payload, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  }
  if (/\bgzip\b/.test(accepts)) {
    reply.header("content-encoding", "gzip");
    return gzipSync(payload, { level: 6 });
  }
  return payload;
});

function sendError(reply: FastifyReply, error: unknown): void {
  if (reply.sent) return;
  if (error instanceof AppError) {
    reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof Error && error.name === "AbortError") return;
  reply.log.error(error);
  reply.status(500).send({ error: { code: "unavailable", message: tr("internal") } });
}

/** Aborts work when the browser gives up on the request (a newer search replaced it). */
function abortOnClose(reply: FastifyReply): AbortController {
  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller;
}

app.get("/api/health", async () => ({ ok: true as const, apiKeyConfigured: apiKeyConfigured() }));

/** Requests to the pp catalogue mirror, for troubleshooting. */
app.get("/api/health/catalog", async () => ({ ...catalogHealth(), warmer: warmerStatus() }));

/** Progress of the full catalogue scan. */
app.get("/api/scan", async () => scanStatus());

/**
 * Every map type known so far, compact and gzipped. Saved as data/patterns-seed.json.gz in
 * the repository, it lets a fresh server know the whole catalogue from the start.
 */
app.get("/api/patterns-seed.json.gz", async (_request, reply) => {
  const body = await exportPacked();
  return reply
    .header("content-type", "application/gzip")
    .header("content-disposition", 'attachment; filename="patterns-seed.json.gz"')
    .header("cache-control", "no-store")
    .send(body);
});

/** Which beatmap mirrors answer from this host, for troubleshooting. */
app.get("/api/health/mirrors", async () => ({ mirrors: mirrorHealth() }));

app.get("/api/search", async (request, reply) => {
  const params = request.query as { q?: unknown; ranked?: unknown };
  const query = typeof params.q === "string" ? params.q : "";
  const ranked = params.ranked === "1" || params.ranked === "true";
  const controller = abortOnClose(reply);
  try {
    return await search(query, controller.signal, ranked);
  } catch (error) {
    sendError(reply, error);
  }
});

app.post("/api/lookup", async (request, reply) => {
  try {
    const timing: Timing = {};
    const start = performance.now();
    const result = await lookup(parseLookup(request.body), timing);
    timing.total = performance.now() - start;
    reply.header("server-timing", Object.entries(timing).map(([name, ms]) => `${name};dur=${ms.toFixed(0)}`).join(", "));
    return result;
  } catch (error) {
    sendError(reply, error);
  }
});

app.post("/api/discover", async (request, reply) => {
  const controller = abortOnClose(reply);
  try {
    return await discover(parseDiscover(request.body), controller.signal);
  } catch (error) {
    sendError(reply, error);
  }
});

/** The raw .osu file, for the auto player drawn in the browser. */
app.get("/api/osu/:id", async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) {
    sendError(reply, new AppError("invalid", tr("request.beatmap"), 400));
    return;
  }
  try {
    const text = await fetchBeatmapText(id);
    reply.header("content-type", "text/plain; charset=utf-8").header("cache-control", "public, max-age=86400");
    return text;
  } catch (error) {
    sendError(reply, error);
  }
});

/** The full song of a map (pulled from its .osz), for the auto player. */
app.get("/api/audio/:id", async (request, reply) => {
  const id = Number((request.params as { id?: string }).id);
  const hint = Number((request.query as { s?: string }).s ?? 0);
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) {
    sendError(reply, new AppError("invalid", tr("request.beatmap"), 400));
    return;
  }
  try {
    const { bytes, type } = await mapAudio(id, Number.isInteger(hint) && hint > 0 ? hint : null);
    reply.header("content-type", type).header("cache-control", "public, max-age=604800");
    return reply.send(bytes);
  } catch (error) {
    sendError(reply, error);
  }
});

app.post("/api/prefetch", async (request, reply) => {
  const body = (request.body ?? {}) as { beatmapId?: unknown; beatmapsetId?: unknown };
  const id = typeof body.beatmapId === "number" && Number.isInteger(body.beatmapId) && body.beatmapId > 0 ? body.beatmapId : null;
  const setId = typeof body.beatmapsetId === "number" && Number.isInteger(body.beatmapsetId) && body.beatmapsetId > 0 ? body.beatmapsetId : null;
  if (id != null) prefetch(id, setId);
  reply.status(204).send();
});

/* ---------- sign in with osu!, marks, top plays ---------- */

/**
 * Sign-in pages are only hops to and from osu.ppy.sh: never cached, never indexed, and the
 * one-time code never leaks through the Referer header.
 */
app.addHook("onSend", async (request, reply, payload) => {
  if (request.url.startsWith("/api/")) reply.header("x-robots-tag", "noindex, nofollow");
  if (request.url.startsWith("/api/auth/")) {
    reply.header("cache-control", "no-store");
    reply.header("referrer-policy", "no-referrer");
  }
  return payload;
});

app.get("/api/auth/login", async (_request, reply) => {
  try {
    return reply.redirect(loginRedirect());
  } catch (error) {
    sendError(reply, error);
  }
});

app.get("/api/auth/callback", async (request, reply) => {
  const params = request.query as { code?: unknown; state?: unknown; error?: unknown };
  if (typeof params.code !== "string" || typeof params.state !== "string") {
    reply.header("set-cookie", loginErrorCookie(typeof params.error === "string" ? `osu!: ${params.error}` : "Sign-in cancelled."));
    return reply.redirect("/");
  }
  try {
    const session = await completeLogin(params.code, params.state);
    reply.header("set-cookie", sessionCookie(session, SESSION_MAX_AGE));
    // 303: the browser lands on the home page with a clean address (no code in it).
    return reply.redirect("/", 303);
  } catch (error) {
    request.log.warn({ err: error }, "osu! sign-in failed");
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    reply.header("set-cookie", loginErrorCookie(message));
    return reply.redirect("/");
  }
});

/** Global rank for a pp total (signed-in players get an estimate below the top 10,000). */
app.get("/api/rank", async (request, reply) => {
  try {
    reply.header("cache-control", "no-store");
    const pp = Number((request.query as { pp?: string }).pp);
    if (!Number.isFinite(pp) || pp <= 0 || pp > 100000) throw new InputError("pp must be a positive number.");
    const profile = currentUser(sessionFromCookie(request.headers.cookie));
    const anchor = profile?.pp && profile.rank ? { pp: profile.pp, rank: profile.rank } : undefined;
    return { result: await rankForPp(pp, anchor, profile?.mode ?? "osu") };
  } catch (error) {
    sendError(reply, error);
  }
});

/** Farm maps suggested from the signed-in player's top plays. */
app.get("/api/recommend", async (request, reply) => {
  try {
    reply.header("cache-control", "no-store");
    const raw = String((request.query as { skip?: string }).skip ?? "");
    const skip = new Set(raw.split(",").slice(0, 400).map(Number).filter((id) => Number.isInteger(id) && id > 0));
    return await recommend(sessionFromCookie(request.headers.cookie), skip);
  } catch (error) {
    sendError(reply, error);
  }
});

/** "My profile": player card and "if I had FC'd" for the signed-in player. */
app.get("/api/profile", async (request, reply) => {
  try {
    reply.header("cache-control", "no-store");
    return await profileInsights(sessionFromCookie(request.headers.cookie));
  } catch (error) {
    sendError(reply, error);
  }
});

/** The signed-in player's banner from this origin, for the PNG card. */
app.get("/api/profile/cover", async (request, reply) => {
  const profile = currentUser(sessionFromCookie(request.headers.cookie));
  if (!profile) return reply.code(401).send();
  try {
    const image = await coverBytes(profile.coverUrl);
    if (!image) return reply.code(404).send();
    reply.header("cache-control", "private, max-age=3600");
    reply.header("content-type", image.type);
    return reply.send(image.body);
  } catch {
    return reply.code(502).send();
  }
});

/** Avatars served from this origin, so the player card can be exported as a PNG. */
app.get("/api/avatar/:id", async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0 || id > 1e9) return reply.code(400).send();
  try {
    const image = await avatarBytes(id);
    if (!image) return reply.code(404).send();
    reply.header("cache-control", "public, max-age=86400");
    reply.header("content-type", image.type);
    return reply.send(image.body);
  } catch {
    return reply.code(502).send();
  }
});

/* ---------- visit stats (owner only) ---------- */

function hitInput(request: { body: unknown; headers: Record<string, string | string[] | undefined>; ip: string }) {
  const country = request.headers["cf-ipcountry"];
  return {
    body: request.body,
    ip: clientIp(request),
    userAgent: String(request.headers["user-agent"] ?? ""),
    country: typeof country === "string" ? country.toUpperCase() : undefined,
    lang: String(request.headers["x-lang"] ?? ""),
    host: String(request.headers.host ?? ""),
    signedIn: currentUser(sessionFromCookie(request.headers.cookie as string | undefined)) != null,
  };
}

for (const [path, record] of [
  ["/api/hit", recordHit],
  ["/api/leave", recordLeave],
  ["/api/event", recordEvent],
] as const) {
  app.post(path, async (request, reply) => {
    try {
      await record(hitInput(request));
    } catch (error) {
      request.log.warn({ err: error }, "stats failed");
    }
    reply.code(204).send();
  });
}

app.get("/api/stats", async (request, reply) => {
  try {
    requireAdmin(request.headers.cookie);
    reply.header("cache-control", "no-store");
    return await readStats(Number((request.query as { days?: string }).days ?? 30));
  } catch (error) {
    sendError(reply, error);
  }
});

/* ---------- feedback ---------- */

function clientIp(request: { headers: Record<string, string | string[] | undefined>; ip: string }): string {
  const header = request.headers["cf-connecting-ip"] ?? request.headers["x-forwarded-for"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value ?? request.ip).split(",")[0].trim();
}

function requireAdmin(cookie: string | undefined): void {
  const user = currentUser(sessionFromCookie(cookie));
  if (!user) throw new AppError("signed_out", "Sign in with osu! first.", 401);
  if (!isAdmin(user)) throw new AppError("not_found", "Not found.", 404);
}

app.post("/api/feedback", async (request, reply) => {
  try {
    const user = currentUser(sessionFromCookie(request.headers.cookie));
    const lang = String(request.headers["x-lang"] ?? "");
    await addFeedback(request.body, clientIp(request), user ? { id: user.id, username: user.username } : null, lang);
    return { ok: true };
  } catch (error) {
    sendError(reply, error);
  }
});

app.get("/api/feedback", async (request, reply) => {
  try {
    requireAdmin(request.headers.cookie);
    reply.header("cache-control", "no-store");
    return { items: await listFeedback() };
  } catch (error) {
    sendError(reply, error);
  }
});

app.patch("/api/feedback/:id", async (request, reply) => {
  try {
    requireAdmin(request.headers.cookie);
    const done = Boolean((request.body as { done?: unknown } | null)?.done);
    await updateFeedback(String((request.params as { id?: string }).id ?? ""), done);
    return { ok: true };
  } catch (error) {
    sendError(reply, error);
  }
});

app.delete("/api/feedback/:id", async (request, reply) => {
  try {
    requireAdmin(request.headers.cookie);
    await deleteFeedback(String((request.params as { id?: string }).id ?? ""));
    return { ok: true };
  } catch (error) {
    sendError(reply, error);
  }
});

app.post("/api/auth/logout", async (request, reply) => {
  logout(sessionFromCookie(request.headers.cookie));
  reply.header("set-cookie", sessionCookie("", 0));
  return { ok: true };
});

app.get("/api/me", async (request, reply) => {
  reply.header("cache-control", "no-store");
  try {
    return await me(sessionFromCookie(request.headers.cookie));
  } catch (error) {
    sendError(reply, error);
  }
});

app.put("/api/me/marks", async (request, reply) => {
  try {
    const body = (request.body ?? {}) as { marks?: unknown; pins?: unknown };
    if (!body.marks || typeof body.marks !== "object" || Array.isArray(body.marks)) {
      throw new AppError("invalid", "Send { marks: { beatmapId: \"farm\" | \"done\" | null } }.", 400);
    }
    const pins = body.pins && typeof body.pins === "object" && !Array.isArray(body.pins) ? (body.pins as Record<string, unknown>) : {};
    return await setMarks(sessionFromCookie(request.headers.cookie), body.marks as Record<string, "farm" | "done" | null>, pins);
  } catch (error) {
    sendError(reply, error);
  }
});

app.post("/api/calculate", async (request, reply) => {
  try {
    return await calculate(parseCalculate(request.body));
  } catch (error) {
    sendError(reply, error);
  }
});

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);
  if (reply.sent) return;
  reply.status(500).send({ error: { code: "unavailable", message: tr("internal") } });
});

const webRoot = join(repoRoot, "web", "dist");
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, {
    root: webRoot,
    preCompressed: true,
    // In @fastify/static 10 this receives the Fastify reply, not the raw Node response.
    setHeaders(reply: FastifyReply, path: string) {
      // Vite fingerprints everything under assets/, so it never changes under the same name.
      if (/[\\/]assets[\\/]/.test(path)) reply.header("cache-control", "public, max-age=31536000, immutable");
      else reply.header("cache-control", "no-cache");
    },
  });
}

await app.listen({ port, host });

// The old index format kept whole ranges with tags and covers; bands replace it.
void rm(join(repoRoot, "cache", "pp-index"), { recursive: true, force: true }).catch(() => undefined);
warmFinderIndex();
startFullScan();
startCatalogueWarmer();
