// Writes .br and .gz next to each built asset so the server can send them as is.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../dist/", import.meta.url));

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(js|css|html|svg|json)$/.test(entry.name)) {
      const body = await readFile(path);
      if (body.length < 1024) continue;
      await writeFile(`${path}.br`, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }));
      await writeFile(`${path}.gz`, gzipSync(body, { level: 9 }));
    }
  }
}

await walk(root);
