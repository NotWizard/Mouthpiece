import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("ApiKeyInput supports inline masked entry with reveal toggle", async () => {
  const source = await readRepoFile("src/components/ui/ApiKeyInput.tsx");

  assert.match(source, /saveMode\?: "manual" \| "immediate";/);
  assert.match(source, /saveMode = "manual"/);
  assert.match(source, /EyeOff/);
  assert.match(source, /const \[isFocused, setIsFocused\] = useState\(false\);/);
  assert.match(source, /const \[isRevealed, setIsRevealed\] = useState\(false\);/);
  assert.match(source, /"\*"\.repeat/);
  assert.match(source, /const displayValue = showPlaintext \? draft : maskKey\(draft\);/);
  assert.match(source, /onFocus=\{handleFocus\}/);
  assert.match(source, /onBlur=\{handleBlur\}/);
  assert.match(
    source,
    /aria-label=\{isRevealed \? t\("apiKeyInput.hide"\) : t\("apiKeyInput.show"\)\}/
  );
  assert.doesNotMatch(source, /<Check className=/);
  assert.doesNotMatch(source, /<X className=/);
});

test("custom transcription and reasoning API key sections use immediate-save mode", async () => {
  const [transcriptionSource, reasoningSource] = await Promise.all([
    readRepoFile("src/components/TranscriptionModelPicker.tsx"),
    readRepoFile("src/components/ReasoningModelSelector.tsx"),
  ]);

  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "custom"[\s\S]*?<ApiKeyInput[\s\S]*saveMode="immediate"/
  );
  assert.match(
    reasoningSource,
    /selectedCloudProvider === "custom"[\s\S]*?<ApiKeyInput[\s\S]*saveMode="immediate"/
  );
  assert.match(reasoningSource, /customReasoningEnableThinking: boolean;/);
  assert.match(reasoningSource, /setCustomReasoningEnableThinking: \(enabled: boolean\) => void;/);
  assert.match(
    reasoningSource,
    /selectedCloudProvider === "custom"[\s\S]*?<Toggle[\s\S]*checked=\{customReasoningEnableThinking\}[\s\S]*onChange=\{setCustomReasoningEnableThinking\}/
  );
});

test("apiKeyInput translations include show and hide labels", async () => {
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
    assert.match(source, /"apiKeyInput": \{[\s\S]*"show": /);
    assert.match(source, /"apiKeyInput": \{[\s\S]*"hide": /);
  }
});
