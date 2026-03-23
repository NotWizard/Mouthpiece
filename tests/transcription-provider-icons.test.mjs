import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

test("provider icon registry exposes Deepgram and Soniox assets for transcription tabs", async () => {
  const source = await read("src/utils/providerIcons.ts");

  assert.match(source, /import deepgramIcon from "@\/assets\/icons\/providers\/deepgram\.png";/);
  assert.match(source, /import sonioxIcon from "@\/assets\/icons\/providers\/soniox\.png";/);
  assert.match(source, /deepgram: deepgramIcon/);
  assert.match(source, /soniox: sonioxIcon/);
});

test("Deepgram and Soniox icon assets are vendored in the provider icon directory", async () => {
  await fs.access(path.join(repoRoot, "src/assets/icons/providers/deepgram.png"));
  await fs.access(path.join(repoRoot, "src/assets/icons/providers/soniox.png"));
});
