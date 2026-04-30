import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("settings page no longer renders a post-processing strategy card", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.doesNotMatch(source, /PostProcessingStrategyCard/);
  assert.doesNotMatch(source, /defaultOutputStrategy/);
  assert.doesNotMatch(source, /setDefaultOutputStrategy/);
  assert.match(source, /PromptStudio/);
});

test("transcription settings show configuration directly without a custom setup selector card", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.match(source, /<TranscriptionModelPicker/);
  assert.doesNotMatch(source, /showCustomSetup/);
  assert.doesNotMatch(source, /mouthpieceSelected/);
  assert.doesNotMatch(source, /settingsPage\.transcription\.customSetup/);
  assert.doesNotMatch(source, /settingsPage\.transcription\.customSetupDescription/);
});

test("transcription locales do not keep unused custom setup selector copy", async () => {
  const localeFiles = [
    "src/locales/de/translation.json",
    "src/locales/en/translation.json",
    "src/locales/es/translation.json",
    "src/locales/fr/translation.json",
    "src/locales/it/translation.json",
    "src/locales/ja/translation.json",
    "src/locales/pt/translation.json",
    "src/locales/ru/translation.json",
    "src/locales/zh-CN/translation.json",
    "src/locales/zh-TW/translation.json",
  ];

  for (const localeFile of localeFiles) {
    const locale = JSON.parse(await readRepoFile(localeFile));
    const transcription = locale.settingsPage.transcription;
    assert.equal(transcription.customSetup, undefined, localeFile);
    assert.equal(transcription.customSetupDescription, undefined, localeFile);
    assert.equal(transcription.mouthpieceCloud, undefined, localeFile);
    assert.equal(transcription.mouthpieceCloudDescription, undefined, localeFile);
    assert.equal(transcription.toasts, undefined, localeFile);
    assert.equal(transcription.cloudDisabled, undefined, localeFile);
    assert.equal(transcription.cloudOffline, undefined, localeFile);
  }
});
