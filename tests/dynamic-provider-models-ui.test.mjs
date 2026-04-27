import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("transcription provider picker discovers models dynamically instead of selecting static defaults", async () => {
  const source = await readRepoFile("src/components/TranscriptionModelPicker.tsx");

  assert.match(source, /providerModelDiscovery\.mjs/);
  assert.match(source, /loadDiscoveredCloudModels/);
  assert.match(source, /SearchableModelSelect/);
  assert.match(source, /manualCloudModelInput/);
  assert.doesNotMatch(source, /onCloudModelSelect\(provider\.models\[0\]\.id\)/);
  assert.doesNotMatch(source, /onCloudModelSelect\("whisper-1"\)/);
});

test("reasoning provider picker discovers built-in provider models via provider API", async () => {
  const source = await readRepoFile("src/components/ReasoningModelSelector.tsx");

  assert.match(source, /providerModelDiscovery\.mjs/);
  assert.match(source, /loadDiscoveredCloudModels/);
  assert.match(source, /getReasoningProviderApiKey/);
  assert.match(source, /manualReasoningModelInput/);
  assert.match(source, /SearchableModelSelect/);
  assert.doesNotMatch(source, /setReasoningModel\(providerData\.models\[0\]\.value\)/);
});

test("model discovery UI strings exist across every supported translation file", async () => {
  const localeFiles = [
    "src/locales/en/translation.json",
    "src/locales/de/translation.json",
    "src/locales/es/translation.json",
    "src/locales/fr/translation.json",
    "src/locales/it/translation.json",
    "src/locales/ja/translation.json",
    "src/locales/pt/translation.json",
    "src/locales/ru/translation.json",
    "src/locales/zh-CN/translation.json",
    "src/locales/zh-TW/translation.json",
  ];

  const localeSources = await Promise.all(localeFiles.map(readRepoFile));

  for (const source of localeSources) {
    assert.match(source, /"modelDiscovery": \{/);
    assert.match(source, /"fetching": /);
    assert.match(source, /"manualEntryLabel": /);
    assert.match(source, /"providerModelHint": /);
  }
});

test("dynamic model dropdowns can overflow provider cards instead of being clipped", async () => {
  const [reasoningSource, modelPickerStylesSource] = await Promise.all([
    readRepoFile("src/components/ReasoningModelSelector.tsx"),
    readRepoFile("src/utils/modelPickerStyles.ts"),
  ]);

  assert.doesNotMatch(reasoningSource, /border border-border rounded-lg overflow-hidden/);
  assert.doesNotMatch(modelPickerStylesSource, /rounded-lg overflow-hidden border/);
});

test("model dropdown scrolls the surrounding panel when opened near the viewport bottom", async () => {
  const source = await readRepoFile("src/components/ui/SearchableModelSelect.tsx");

  assert.match(source, /ensureDropdownVisible/);
  assert.match(source, /dropdownRef/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /preventScroll: true/);
  assert.match(source, /scrollBy\(\{\s*top:/s);
});
