import "./env";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { apiKeyConfigured, mirrorHealth } from "./osuApi";
import { parseCalculate, parseDiscover, parseLookup } from "./body";
import { host, port, repoRoot } from "./env";
import { AppError } from "./errors";
import { completeLogin, loginErrorCookie, loginRedirect, logout, me, SESSION_MAX_AGE, sessionCookie, sessionFromCookie, setMarks } from "./account";
import { bindLang, tr } from "./locale";
import { exportPacked } from "./patternStore";
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

app.post("/api/prefetch", async (request, reply) => {
  const body = (request.body ?? {}) as { beatmapId?: unknown; beatmapsetId?: unknown };
  const id = typeof body.beatmapId === "number" && Number.isInteger(body.beatmapId) && body.beatmapId > 0 ? body.beatmapId : null;
  const setId = typeof body.beatmapsetId === "number" && Number.isInteger(body.beatmapsetId) && body.beatmapsetId > 0 ? body.beatmapsetId : null;
  if (id != null) prefetch(id, setId);
  reply.status(204).send();
});

/* ---------- sign in with osu!, marks, top plays ---------- */

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
    return reply.redirect("/");
  } catch (error) {
    request.log.warn({ err: error }, "osu! sign-in failed");
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    reply.header("set-cookie", loginErrorCookie(message));
    return reply.redirect("/");
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
    const body = (request.body ?? {}) as { marks?: unknown };
    if (!body.marks || typeof body.marks !== "object" || Array.isArray(body.marks)) {
      throw new AppError("invalid", "Send { marks: { beatmapId: \"farm\" | \"done\" | null } }.", 400);
    }
    const marks = await setMarks(sessionFromCookie(request.headers.cookie), body.marks as Record<string, "farm" | "done" | null>);
    return { marks };
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
