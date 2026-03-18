import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

const SECRET_SETTING_KEYS = [
  "openaiApiKey",
  "anthropicApiKey",
  "geminiApiKey",
  "groqApiKey",
  "mistralApiKey",
  "bailianApiKey",
  "customTranscriptionApiKey",
  "customReasoningApiKey",
];

test("settings store no longer persists API keys to renderer localStorage", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  for (const key of SECRET_SETTING_KEYS) {
    assert.doesNotMatch(source, new RegExp(`localStorage\\.setItem\\("${key}"`));
  }
});

test("settings initialization no longer seeds API key state from renderer localStorage reads", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  for (const key of SECRET_SETTING_KEYS) {
    assert.doesNotMatch(source, new RegExp(`readString\\("${key}"`));
  }
});

test("settings initialization scrubs legacy API keys from renderer localStorage", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  assert.match(source, /SECRET_SETTING_KEYS/);
  assert.match(source, /localStorage\.removeItem\(key\)/);
});

test("BYOK detection no longer depends on renderer localStorage secrets", async () => {
  const source = await readRepoFile("src/utils/byokDetection.ts");

  assert.doesNotMatch(source, /localStorage\.getItem/);
});

test("debug logging no longer includes API key previews", async () => {
  const [audioManagerSource, reasoningSource] = await Promise.all([
    readRepoFile("src/helpers/audioManager.js"),
    readRepoFile("src/services/ReasoningService.ts"),
  ]);

  assert.doesNotMatch(audioManagerSource, /keyPreview|apiKeyPreview|substring\(0,\s*8\)/);
  assert.doesNotMatch(reasoningSource, /apiKeyPreview|substring\(0,\s*8\)/);
});
