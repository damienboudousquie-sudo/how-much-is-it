import "./env";
import { existsSync } from "node:fs";
import { join } from "node:path";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";
import { apiKeyConfigured } from "./osuApi";
import { parseCalculate, parseDiscover, parseLookup } from "./body";
import { host, port, repoRoot } from "./env";
import { AppError } from "./errors";
import { bindLang, tr } from "./locale";
import { calculate, discover, lookup, search, warmFinderIndex } from "./service";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.addHook("onRequest", (request, _reply, done) => {
  bindLang(request.headers["x-lang"]);
  done();
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

app.get("/api/health", async () => ({ ok: true as const, apiKeyConfigured: apiKeyConfigured() }));

app.get("/api/search", async (request, reply) => {
  const query = typeof (request.query as { q?: unknown }).q === "string" ? (request.query as { q: string }).q : "";
  const controller = new AbortController();
  request.raw.on("aborted", () => controller.abort());
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
  const controller = new AbortController();
  request.raw.on("aborted", () => controller.abort());
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
  await app.register(fastifyStatic, { root: webRoot });
}

await app.listen({ port, host });
warmFinderIndex();
