import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { repoRoot } from "./env";
import { AppError } from "./errors";
import { fetchBeatmapText } from "./beatmapCache";

/**
 * The full song of a map, for the auto player. Mirrors only serve whole .osz archives, so
 * the archive is downloaded once, the song is pulled out of it and kept on disk; the
 * archive itself is not kept.
 */

const DIR = join(repoRoot, "cache", "audio");
const MAX_ARCHIVE = 80 * 1024 * 1024;
const MAX_CACHE = 3 * 1024 * 1024 * 1024;
const SOURCES = [
  (setId: number) => `https://osu.direct/api/d/${setId}?noVideo=1`,
  (setId: number) => `https://catboy.best/d/${setId}n`,
  (setId: number) => `https://api.nerinyan.moe/d/${setId}?nv=1`,
];

const TYPES: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4" };
const inflight = new Map<string, Promise<Buffer>>();
let downloads = 0;
const queue: (() => void)[] = [];

async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (downloads >= 2) await new Promise<void>((resolve) => queue.push(resolve));
  downloads += 1;
  try {
    return await work();
  } finally {
    downloads -= 1;
    queue.shift()?.();
  }
}

function field(text: string, name: string): string | null {
  const match = text.match(new RegExp(`^${name}\\s*:\\s*(.+)$`, "mi"));
  return match ? match[1].trim() : null;
}

/** Reads one file out of a zip archive (stored or deflated), by name, ignoring case. */
function unzipOne(zip: Buffer, wanted: string): Buffer | null {
  const target = wanted.replace(/\\/g, "/").toLowerCase();
  // End of central directory: last 22 bytes plus up to 64 KB of comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && at + 46 <= zip.length; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8").replace(/\\/g, "/").toLowerCase();
    at += 46 + nameLength + extraLength + commentLength;
    if (name !== target) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    return null;
  }
  return null;
}

async function downloadArchive(setId: number): Promise<Buffer> {
  let lastStatus = 0;
  for (const source of SOURCES) {
    try {
      const response = await fetch(source(setId), { signal: AbortSignal.timeout(60_000), headers: { "user-agent": "how-much-is-it (osu! pp finder)" } });
      lastStatus = response.status;
      if (!response.ok) continue;
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_ARCHIVE) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_ARCHIVE || bytes.length < 100) continue;
      return bytes;
    } catch {
      // Try the next mirror.
    }
  }
  if (lastStatus === 404) throw new AppError("not_found", "Song not found on the mirrors.", 404);
  throw new AppError("unavailable", "The mirrors did not send the song.", 502);
}

/** Keeps the audio folder under its size limit, oldest files first. */
async function trim(): Promise<void> {
  const names = await readdir(DIR).catch(() => [] as string[]);
  const files = await Promise.all(names.map(async (name) => ({ name, info: await stat(join(DIR, name)).catch(() => null) })));
  const list = files.filter((file) => file.info).sort((a, b) => a.info!.mtimeMs - b.info!.mtimeMs);
  let total = list.reduce((sum, file) => sum + file.info!.size, 0);
  for (const file of list) {
    if (total <= MAX_CACHE) break;
    await rm(join(DIR, file.name), { force: true });
    total -= file.info!.size;
  }
}

export async function mapAudio(beatmapId: number, setHint: number | null): Promise<{ bytes: Buffer; type: string }> {
  const text = await fetchBeatmapText(beatmapId);
  const audioName = field(text, "AudioFilename");
  const setId = Number(field(text, "BeatmapSetID") ?? setHint ?? 0);
  if (!audioName || !Number.isInteger(setId) || setId <= 0) throw new AppError("not_found", "This map does not name its song.", 404);
  const ext = (audioName.split(".").pop() ?? "mp3").toLowerCase();
  const type = TYPES[ext] ?? "application/octet-stream";
  const safe = audioName.replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
  const file = join(DIR, `${setId}-${safe}`);
  const cached = await readFile(file).catch(() => null);
  if (cached) return { bytes: cached, type };

  let pending = inflight.get(file);
  if (!pending) {
    pending = slot(async () => {
      const archive = await downloadArchive(setId);
      const song = unzipOne(archive, audioName);
      if (!song) throw new AppError("not_found", "The song is missing from the archive.", 404);
      await mkdir(DIR, { recursive: true });
      await writeFile(file, song);
      void trim();
      return song;
    }).finally(() => inflight.delete(file));
    inflight.set(file, pending);
  }
  return { bytes: await pending, type };
}
