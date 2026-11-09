import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FeedbackItem, FeedbackKind } from "@osu-pp/shared";
import { repoRoot } from "./env";
import { AppError } from "./errors";

/** Opinions and bug reports sent from the site, kept in one small JSON file. */

const DIR = join(repoRoot, "cache", "feedback");
const FILE = join(DIR, "feedback.json");
const MAX_ITEMS = 2000;
const KINDS = new Set<FeedbackKind>(["bug", "idea", "other"]);

let items: FeedbackItem[] | null = null;
let saving = Promise.resolve();

async function load(): Promise<FeedbackItem[]> {
  if (items) return items;
  try {
    const parsed = JSON.parse(await readFile(FILE, "utf8")) as unknown;
    items = Array.isArray(parsed) ? (parsed as FeedbackItem[]) : [];
  } catch {
    items = [];
  }
  return items;
}

function save(): Promise<void> {
  const snapshot = JSON.stringify(items ?? []);
  saving = saving.then(async () => {
    await mkdir(DIR, { recursive: true });
    await writeFile(`${FILE}.tmp`, snapshot);
    await rename(`${FILE}.tmp`, FILE);
  });
  return saving;
}

// A few messages per visitor and per 10 minutes is plenty; more is spam.
const recent = new Map<string, number[]>();
function allow(ip: string): boolean {
  const now = Date.now();
  const times = (recent.get(ip) ?? []).filter((at) => now - at < 10 * 60 * 1000);
  if (times.length >= 5) return false;
  times.push(now);
  recent.set(ip, times);
  if (recent.size > 5000) recent.clear();
  return true;
}

const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "");

export async function addFeedback(body: unknown, ip: string, user: { id: number; username: string } | null, lang: string): Promise<void> {
  const raw = (body ?? {}) as Record<string, unknown>;
  const kind = KINDS.has(raw.kind as FeedbackKind) ? (raw.kind as FeedbackKind) : "other";
  const message = text(raw.message, 2000);
  if (message.length < 3) throw new AppError("invalid", "Write a few words first.", 400);
  if (!allow(ip)) throw new AppError("rate_limited", "Too many messages. Try again in a few minutes.", 429);
  const list = await load();
  list.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    message,
    contact: text(raw.contact, 100) || null,
    page: text(raw.page, 300) || null,
    lang: text(lang, 8) || null,
    user,
    done: false,
  });
  if (list.length > MAX_ITEMS) list.length = MAX_ITEMS;
  await save();
}

export async function listFeedback(): Promise<FeedbackItem[]> {
  return load();
}

export async function updateFeedback(id: string, done: boolean): Promise<void> {
  const item = (await load()).find((entry) => entry.id === id);
  if (!item) throw new AppError("not_found", "Not found.", 404);
  item.done = done;
  await save();
}

export async function deleteFeedback(id: string): Promise<void> {
  const list = await load();
  const at = list.findIndex((entry) => entry.id === id);
  if (at < 0) throw new AppError("not_found", "Not found.", 404);
  list.splice(at, 1);
  await save();
}
