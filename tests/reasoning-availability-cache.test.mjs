import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

async function importCacheHelper() {
  const moduleUrl = `${pathToFileURL(
    path.resolve(repoRoot, "src/utils/reasoningAvailabilityCacheKey.mjs")
  ).href}?ts=${Date.now()}`;
  return import(moduleUrl);
}

test("reasoning availability cache key changes when custom reasoning key becomes available", async () => {
  const { getReasoningAvailabilityCacheKey } = await importCacheHelper();

  const baseSettings = {
    useReasoningModel: true,
    reasoningProvider: "custom",
    reasoningModel: "qwen3.5-flash",
    cloudReasoningMode: "byok",
    isSignedIn: false,
    cloudReasoningBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    customReasoningApiKey: "",
  };

  const initialKey = getReasoningAvailabilityCacheKey(baseSettings);
  const hydratedKey = getReasoningAvailabilityCacheKey({
    ...baseSettings,
    customReasoningApiKey: "sk-test-custom",
  });

  assert.notEqual(initialKey, hydratedKey);
});

test("reasoning availability cache key changes when the custom endpoint changes", async () => {
  const { getReasoningAvailabilityCacheKey } = await importCacheHelper();

  const baseSettings = {
    useReasoningModel: true,
    reasoningProvider: "custom",
    reasoningModel: "qwen3.5-flash",
    cloudReasoningMode: "byok",
    isSignedIn: false,
    customReasoningApiKey: "sk-test-custom",
    cloudReasoningBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  };

  const initialKey = getReasoningAvailabilityCacheKey(baseSettings);
  const migratedKey = getReasoningAvailabilityCacheKey({
    ...baseSettings,
    cloudReasoningBaseUrl: "https://api.example.com/v1",
  });

  assert.notEqual(initialKey, migratedKey);
});

test("audio manager availability cache tracks a reasoning config fingerprint instead of only the enable toggle", async () => {
  const source = await fs.readFile(
    path.resolve(repoRoot, "src/helpers/audioManager.js"),
    "utf8"
  );

  assert.match(source, /cachedReasoningAvailabilityKey/);
  assert.match(source, /const cacheKey = getReasoningAvailabilityCacheKey\(settings\);/);
  assert.match(source, /this\.cachedReasoningAvailabilityKey === cacheKey/);
});
