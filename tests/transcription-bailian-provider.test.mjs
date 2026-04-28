import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

async function importHelper() {
  const moduleUrl = `${
    pathToFileURL(path.resolve(repoRoot, "src/utils/transcriptionProviderConfig.mjs")).href
  }?ts=${Date.now()}`;
  return import(moduleUrl);
}

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(repoRoot, relativePath), "utf8");
}

test("legacy custom DashScope transcription settings are promoted to explicit Bailian provider", async () => {
  const { normalizeCloudTranscriptionProviderSettings } = await importHelper();

  const normalized = normalizeCloudTranscriptionProviderSettings({
    cloudTranscriptionProvider: "custom",
    cloudTranscriptionBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    cloudTranscriptionModel: "qwen3-asr-flash",
    customTranscriptionApiKey: "sk-custom-bailian",
    bailianApiKey: "",
  });

  assert.equal(normalized.cloudTranscriptionProvider, "bailian");
  assert.equal(normalized.cloudTranscriptionModel, "qwen3-asr-flash");
  assert.equal(normalized.bailianApiKey, "sk-custom-bailian");
  assert.equal(normalized.didPromoteCustomDashScope, true);
});

test("existing explicit Bailian selection keeps provider explicit and falls back to the Bailian default model", async () => {
  const { normalizeCloudTranscriptionProviderSettings } = await importHelper();

  const normalized = normalizeCloudTranscriptionProviderSettings({
    cloudTranscriptionProvider: "bailian",
    cloudTranscriptionBaseUrl: "",
    cloudTranscriptionModel: "",
    customTranscriptionApiKey: "",
    bailianApiKey: "sk-bailian",
  });

  assert.equal(normalized.cloudTranscriptionProvider, "bailian");
  assert.equal(normalized.cloudTranscriptionModel, "qwen3-asr-flash");
  assert.equal(normalized.bailianApiKey, "sk-bailian");
  assert.equal(normalized.didPromoteCustomDashScope, false);
});

test("legacy Bailian realtime toggle no longer overwrites the selected batch model", async () => {
  const { normalizeCloudTranscriptionProviderSettings } = await importHelper();

  const normalized = normalizeCloudTranscriptionProviderSettings({
    cloudTranscriptionProvider: "bailian",
    cloudTranscriptionBaseUrl: "",
    cloudTranscriptionModel: "qwen3-asr-flash",
    customTranscriptionApiKey: "",
    bailianApiKey: "sk-bailian",
    bailianRealtimeEnabled: true,
  });

  assert.equal(normalized.cloudTranscriptionProvider, "bailian");
  assert.equal(normalized.cloudTranscriptionModel, "qwen3-asr-flash");
});

test("legacy Bailian realtime toggle preserves an explicit realtime model selection", async () => {
  const { normalizeCloudTranscriptionProviderSettings } = await importHelper();

  const normalized = normalizeCloudTranscriptionProviderSettings({
    cloudTranscriptionProvider: "bailian",
    cloudTranscriptionBaseUrl: "",
    cloudTranscriptionModel: "qwen3-asr-flash-realtime",
    customTranscriptionApiKey: "",
    bailianApiKey: "sk-bailian",
    bailianRealtimeEnabled: true,
  });

  assert.equal(normalized.cloudTranscriptionProvider, "bailian");
  assert.equal(normalized.cloudTranscriptionModel, "qwen3-asr-flash-realtime");
});

test("audio manager treats Bailian as an explicit provider instead of only using custom Qwen ASR routing", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /provider === "bailian"/);
  assert.match(source, /const isBailianProvider = provider === "bailian";/);
  assert.match(source, /\(isCustomProvider \|\| isBailianProvider\) && isQwenAsrModel\(model\)/);
  assert.match(source, /getBailianBatchTranscriptionModel\(trimmedModel\)/);
  assert.match(source, /base = API_ENDPOINTS\.DASHSCOPE_BASE;/);
});

test("settings store imports the transcription provider normalization helper for startup migration", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  assert.match(source, /normalizeCloudTranscriptionProviderSettings/);
  assert.match(source, /normalizeCloudTranscriptionProviderSettings\(/);
  assert.match(source, /setCloudTranscriptionProvider\("bailian"\)|setBailianApiKey\(/);
});
