import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("ApiKeyInput supports immediate-save mode for direct entry flows", async () => {
  const source = await readRepoFile("src/components/ui/ApiKeyInput.tsx");

  assert.match(source, /saveMode\?: "manual" \| "immediate";/);
  assert.match(source, /saveMode = "manual"/);
  assert.match(source, /if \(saveMode === "immediate"\)/);
  assert.match(
    source,
    /<Input[\s\S]*value=\{apiKey\}[\s\S]*onChange=\{\(e\) => setApiKey\(e\.target\.value\)\}/
  );
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

test("bailian reasoning provider is exposed as a first-class cloud option with its own fast defaults", async () => {
  const [reasoningSource, settingsStoreSource, settingsHookSource] = await Promise.all([
    readRepoFile("src/components/ReasoningModelSelector.tsx"),
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/hooks/useSettings.ts"),
  ]);

  assert.match(reasoningSource, /cloudProviderIds = \["openai", "anthropic", "gemini", "groq", "bailian", "custom"\]/);
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

  assert.match(settingsStoreSource, /bailianReasoningEnableThinking: readBoolean\("bailianReasoningEnableThinking", false\)/);
  assert.match(settingsStoreSource, /bailianApiKey: readString\("bailianApiKey", ""\)/);
  assert.match(settingsHookSource, /bailianReasoningEnableThinking: boolean;/);
  assert.match(settingsHookSource, /bailianApiKey: string;/);
});
