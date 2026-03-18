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

test("bailian reasoning provider is exposed as a first-class cloud option with its own fast defaults", async () => {
  const [reasoningSource, settingsStoreSource, settingsHookSource] = await Promise.all([
    readRepoFile("src/components/ReasoningModelSelector.tsx"),
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/hooks/useSettings.ts"),
  ]);

  assert.match(
    reasoningSource,
    /cloudProviderIds = \["openai", "anthropic", "gemini", "groq", "bailian", "custom"\]/
  );
  assert.match(reasoningSource, /selectedCloudProvider === "bailian"/);
  assert.match(reasoningSource, /bailianApiKey\??: string;/);
  assert.match(reasoningSource, /bailianReasoningEnableThinking: boolean;/);
  assert.match(
    reasoningSource,
    /selectedCloudProvider === "bailian"[\s\S]*?<ApiKeyInput[\s\S]*setApiKey=\{setBailianApiKey/
  );
  assert.match(
    reasoningSource,
    /selectedCloudProvider === "bailian"[\s\S]*?<Toggle[\s\S]*checked=\{bailianReasoningEnableThinking\}[\s\S]*onChange=\{setBailianReasoningEnableThinking\}/
  );

  assert.match(
    settingsStoreSource,
    /bailianReasoningEnableThinking: readBoolean\("bailianReasoningEnableThinking", false\)/
  );
  assert.match(settingsStoreSource, /bailianApiKey: ""/);
  assert.match(settingsStoreSource, /setBailianApiKey: createSecretSetter\("bailianApiKey"\)/);
  assert.doesNotMatch(settingsStoreSource, /readString\("bailianApiKey", ""\)/);
  assert.match(settingsHookSource, /bailianReasoningEnableThinking: boolean;/);
  assert.match(settingsHookSource, /bailianApiKey: string;/);
});

test("bailian transcription provider is exposed as a first-class cloud option with its own API key wiring", async () => {
  const [transcriptionSource, settingsPageSource, settingsHookSource] = await Promise.all([
    readRepoFile("src/components/TranscriptionModelPicker.tsx"),
    readRepoFile("src/components/SettingsPage.tsx"),
    readRepoFile("src/hooks/useSettings.ts"),
  ]);

  assert.match(
    transcriptionSource,
    /const CLOUD_PROVIDER_TABS = \[[\s\S]*\{ id: "bailian", name: "Alibaba Bailian" \}[\s\S]*\];/
  );
  assert.match(transcriptionSource, /bailianApiKey\??: string;/);
  assert.match(transcriptionSource, /setBailianApiKey\??: \(key: string\) => void;/);
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "bailian"[\s\S]*?<ApiKeyInput[\s\S]*setApiKey=\{setBailianApiKey/
  );
  assert.match(
    settingsPageSource,
    /<TranscriptionModelPicker[\s\S]*bailianApiKey=\{bailianApiKey\}[\s\S]*setBailianApiKey=\{setBailianApiKey\}/
  );
  assert.match(settingsHookSource, /bailianApiKey: string;/);
  assert.match(settingsHookSource, /setBailianApiKey: store\.setBailianApiKey,/);
});
