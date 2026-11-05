import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

config({ path: resolve(repoRoot, ".env") });

export const port = Number(process.env.PORT) || 3001;
export const host = process.env.HOST || "0.0.0.0";
