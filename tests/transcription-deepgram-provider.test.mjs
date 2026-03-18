import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("Deepgram transcription provider is registered with Nova model options", async () => {
  const source = await readRepoFile("src/models/modelRegistryData.json");

  assert.match(
    source,
    /"id": "deepgram"[\s\S]*"name": "Deepgram"[\s\S]*"baseUrl": "https:\/\/api\.deepgram\.com\/v1"/
  );
  assert.match(source, /"id": "nova-3"/);
  assert.match(source, /"id": "nova-3-medical"/);
});

test("Deepgram settings are persisted through the store, hook, environment manager, preload, and typings", async () => {
  const [settingsStoreSource, settingsHookSource, environmentSource, preloadSource, typesSource] =
    await Promise.all([
      readRepoFile("src/stores/settingsStore.ts"),
      readRepoFile("src/hooks/useSettings.ts"),
      readRepoFile("src/helpers/environment.js"),
      readRepoFile("preload.js"),
      readRepoFile("src/types/electron.ts"),
    ]);

  assert.match(settingsStoreSource, /deepgramStreamingEnabled: readBoolean\("deepgramStreamingEnabled", false\)/);
  assert.match(settingsStoreSource, /deepgramApiKey: readString\("deepgramApiKey", ""\)/);
  assert.match(settingsStoreSource, /setDeepgramStreamingEnabled: createBooleanSetter\("deepgramStreamingEnabled"\)/);
  assert.match(settingsStoreSource, /setDeepgramApiKey: \(key: string\) => \{/);
  assert.match(settingsStoreSource, /window\.electronAPI\?\.saveDeepgramKey\?\.\(key\)/);
  assert.match(settingsStoreSource, /window\.electronAPI\.getDeepgramKey\?\.\(\)/);

  assert.match(settingsHookSource, /deepgramStreamingEnabled: boolean;/);
  assert.match(settingsHookSource, /deepgramApiKey: string;/);
  assert.match(settingsHookSource, /deepgramStreamingEnabled: store\.deepgramStreamingEnabled,/);
  assert.match(settingsHookSource, /deepgramApiKey: store\.deepgramApiKey,/);
  assert.match(settingsHookSource, /setDeepgramStreamingEnabled: store\.setDeepgramStreamingEnabled,/);
  assert.match(settingsHookSource, /setDeepgramApiKey: store\.setDeepgramApiKey,/);

  assert.match(environmentSource, /"DEEPGRAM_API_KEY"/);
  assert.match(environmentSource, /getDeepgramKey\(\)/);
  assert.match(environmentSource, /saveDeepgramKey\(key\)/);

  assert.match(preloadSource, /getDeepgramKey: \(\) => ipcRenderer\.invoke\("get-deepgram-key"\)/);
  assert.match(preloadSource, /saveDeepgramKey: \(key\) => ipcRenderer\.invoke\("save-deepgram-key", key\)/);

  assert.match(typesSource, /getDeepgramKey\?: \(\) => Promise<string \| null>;/);
  assert.match(typesSource, /saveDeepgramKey\?: \(key: string\) => Promise<void>;/);
});

test("Deepgram transcription UI exposes provider tab, API key input, and realtime toggle", async () => {
  const [transcriptionSource, settingsPageSource] = await Promise.all([
    readRepoFile("src/components/TranscriptionModelPicker.tsx"),
    readRepoFile("src/components/SettingsPage.tsx"),
  ]);

  assert.match(
    transcriptionSource,
    /const CLOUD_PROVIDER_TABS = \[[\s\S]*\{ id: "deepgram", name: "Deepgram" \}[\s\S]*\];/
  );
  assert.match(transcriptionSource, /deepgramApiKey\??: string;/);
  assert.match(transcriptionSource, /setDeepgramApiKey\??: \(key: string\) => void;/);
  assert.match(transcriptionSource, /deepgramStreamingEnabled\??: boolean;/);
  assert.match(
    transcriptionSource,
    /setDeepgramStreamingEnabled\??: \(enabled: boolean\) => void;/
  );
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "deepgram"[\s\S]*?<ApiKeyInput[\s\S]*setApiKey=\{setDeepgramApiKey/
  );
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "deepgram"[\s\S]*?<Toggle[\s\S]*checked=\{deepgramStreamingEnabled\}[\s\S]*onChange=\{setDeepgramStreamingEnabled\}/
  );

  assert.match(
    settingsPageSource,
    /<TranscriptionModelPicker[\s\S]*deepgramApiKey=\{deepgramApiKey\}[\s\S]*setDeepgramApiKey=\{setDeepgramApiKey\}[\s\S]*deepgramStreamingEnabled=\{deepgramStreamingEnabled\}[\s\S]*setDeepgramStreamingEnabled=\{setDeepgramStreamingEnabled\}/
  );
});

test("Deepgram API key counts as a stored BYOK credential", async () => {
  const source = await readRepoFile("src/utils/byokDetection.ts");

  assert.match(source, /localStorage\.getItem\("deepgramApiKey"\)/);
});

test("Deepgram locale keys exist across every supported translation file", async () => {
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
    assert.match(source, /"deepgram": \{[\s\S]*"apiKeyHelp": /);
    assert.match(source, /"deepgram": \{[\s\S]*"realtimeLabel": /);
    assert.match(source, /"deepgram": \{[\s\S]*"realtimeDescription": /);
    assert.match(source, /"deepgram_nova_3": /);
    assert.match(source, /"deepgram_nova_3_medical": /);
    assert.match(source, /"deepgram_nova_2_meeting": /);
    assert.match(source, /"deepgram_nova_2_phonecall": /);
  }
});

test("audio manager handles Deepgram batch and realtime transcription as first-class behavior", async () => {
  const [audioManagerSource, ipcHandlersSource, deepgramStreamingSource] = await Promise.all([
    readRepoFile("src/helpers/audioManager.js"),
    readRepoFile("src/helpers/ipcHandlers.js"),
    readRepoFile("src/helpers/deepgramStreaming.js"),
  ]);

  assert.match(audioManagerSource, /provider === "deepgram"/);
  assert.match(audioManagerSource, /if \(provider === "deepgram"\) return "nova-3";/);
  assert.match(audioManagerSource, /base = API_ENDPOINTS\.DEEPGRAM_BASE;/);
  assert.match(audioManagerSource, /Authorization = `Token \$\{apiKey\}`|`Token \$\{apiKey\}`/);
  assert.match(
    audioManagerSource,
    /result\?\.results\?\.channels\?\.\[0\]\?\.alternatives\?\.\[0\]\?\.transcript/
  );
  assert.match(audioManagerSource, /s\.cloudTranscriptionProvider === "deepgram"/);
  assert.match(audioManagerSource, /s\.deepgramStreamingEnabled/);
  assert.match(
    audioManagerSource,
    /getStreamingRequestOptions\(\) \{[\s\S]*model: this\.getTranscriptionModel\(\)/
  );
  assert.match(audioManagerSource, /this\.processTranscription\(finalText, "deepgram-streaming"\)/);

  assert.match(ipcHandlersSource, /"get-deepgram-key"/);
  assert.match(ipcHandlersSource, /"save-deepgram-key"/);
  assert.match(ipcHandlersSource, /authMode === "apiKey"|options\.authMode === "apiKey"/);
  assert.match(ipcHandlersSource, /this\.environmentManager\.getDeepgramKey\(\)/);

  assert.match(deepgramStreamingSource, /Authorization: `Token \$\{token\}`/);
  assert.match(deepgramStreamingSource, /Authorization: `Bearer \$\{token\}`/);
  assert.match(deepgramStreamingSource, /const requestedModel = options\.model/);
});
