import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("main.js does not load dotenv from project root at module load", async () => {
  const source = await readRepoFile("main.js");
  // The early-init dotenv call shadowed userData/.env because dotenv won't override
  // existing keys. Loading must go through EnvironmentManager (which reads userData first).
  assert.doesNotMatch(
    source,
    /require\(["']dotenv["']\)\.config\(\s*\{\s*path:\s*path\.join\(__dirname,/,
    "main.js still calls dotenv.config({ path: path.join(__dirname, '.env') }) at module load"
  );
});

test("EnvironmentManager does not fall back to project root .env", async () => {
  const source = await readRepoFile("src/helpers/environment.js");
  assert.doesNotMatch(
    source,
    /path\.join\(__dirname,\s*["']\.\.\/?["'],\s*["']\.\.\/?["'],\s*["']\.env["']\)/,
    "environment.js still falls back to __dirname/../../.env which shadows userData/.env in dev"
  );
});

test("PERSISTED_KEYS in environment.js includes QWEN_ASR_MODEL", async () => {
  const source = await readRepoFile("src/helpers/environment.js");
  assert.match(
    source,
    /"QWEN_ASR_MODEL"/,
    "QWEN_ASR_MODEL must be in PERSISTED_KEYS so saveAllKeysToEnvFile preserves it"
  );
});
