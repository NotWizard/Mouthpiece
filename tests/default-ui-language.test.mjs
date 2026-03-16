import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("renderer defaults the UI language to zh-CN before any saved preference exists", async () => {
  const [i18nSource, settingsStoreSource] = await Promise.all([
    readRepoFile("src/i18n.ts"),
    readRepoFile("src/stores/settingsStore.ts"),
  ]);

  assert.match(i18nSource, /const initialLanguage = normalizeUiLanguage\(storageLanguage \|\| "zh-CN"\);/);
  assert.match(settingsStoreSource, /uiLanguage: normalizeUiLanguage\(readString\("uiLanguage", "zh-CN"\)\),/);
});

test("main process language fallbacks prefer zh-CN when no UI language is persisted", async () => {
  const [environmentSource, i18nMainSource] = await Promise.all([
    readRepoFile("src/helpers/environment.js"),
    readRepoFile("src/helpers/i18nMain.js"),
  ]);

  assert.match(
    environmentSource,
    /return normalizeUiLanguage\(this\._getKey\("UI_LANGUAGE"\) \|\| "zh-CN"\);/
  );
  assert.match(i18nMainSource, /lng: normalizeUiLanguage\(process\.env\.UI_LANGUAGE \|\| "zh-CN"\),/);
});

test("UI-language-dependent helpers fall back to zh-CN instead of English", async () => {
  const [baseReasoningSource, promptsSource, audioManagerSource] = await Promise.all([
    readRepoFile("src/services/BaseReasoningService.ts"),
    readRepoFile("src/config/prompts.ts"),
    readRepoFile("src/helpers/audioManager.js"),
  ]);

  assert.match(baseReasoningSource, /return getSettings\(\)\.uiLanguage \|\| "zh-CN";/);
  assert.match(promptsSource, /normalizeUiLanguage\(uiLanguage \|\| "zh-CN"\)/);
  assert.match(audioManagerSource, /settings\.uiLanguage \|\| "zh-CN"/);
  assert.match(audioManagerSource, /locale: settings\.uiLanguage \|\| "zh-CN"/);
  assert.match(audioManagerSource, /stSettings\.uiLanguage \|\| "zh-CN"/);
  assert.match(audioManagerSource, /locale: stSettings\.uiLanguage \|\| "zh-CN"/);
});
