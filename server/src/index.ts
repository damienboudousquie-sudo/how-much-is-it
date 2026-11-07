import "./env";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { apiKeyConfigured } from "./osuApi";
import { parseCalculate, parseDiscover, parseLookup } from "./body";
import { host, port, repoRoot } from "./env";
import { AppError } from "./errors";
import { bindLang, tr } from "./locale";
import { calculate, discover, lookup, search, warmFinderIndex } from "./service";

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

app.get("/api/search", async (request, reply) => {
  const query = typeof (request.query as { q?: unknown }).q === "string" ? (request.query as { q: string }).q : "";
  const controller = abortOnClose(reply);
  try {
    return await search(query, controller.signal);
  } catch (error) {
    sendError(reply, error);
  }
});

app.post("/api/lookup", async (request, reply) => {
  try {
    return await lookup(parseLookup(request.body));
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
    setHeaders(res, path) {
      // Vite fingerprints everything under assets/, so it never changes under the same name.
      if (/[\\/]assets[\\/]/.test(path)) res.setHeader("cache-control", "public, max-age=31536000, immutable");
      else res.setHeader("cache-control", "no-cache");
    },
  });
}

await app.listen({ port, host });

// The old index format kept whole ranges with tags and covers; bands replace it.
void rm(join(repoRoot, "cache", "pp-index"), { recursive: true, force: true }).catch(() => undefined);
warmFinderIndex();
