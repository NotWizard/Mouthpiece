import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("Bailian realtime toggle is persisted through the settings store and hook", async () => {
  const [settingsStoreSource, settingsHookSource] = await Promise.all([
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/hooks/useSettings.ts"),
  ]);

  assert.match(
    settingsStoreSource,
    /"bailianRealtimeEnabled"/
  );
  assert.match(
    settingsStoreSource,
    /bailianRealtimeEnabled: readBoolean\("bailianRealtimeEnabled", false\)/
  );
  assert.match(
    settingsStoreSource,
    /setBailianRealtimeEnabled: createBooleanSetter\("bailianRealtimeEnabled"\)/
  );
  assert.match(
    settingsStoreSource,
    /if \(settings\.bailianRealtimeEnabled !== undefined\)[\s\S]*s\.setBailianRealtimeEnabled\(settings\.bailianRealtimeEnabled\);/
  );

  assert.match(settingsHookSource, /bailianRealtimeEnabled: boolean;/);
  assert.match(settingsHookSource, /bailianRealtimeEnabled: store\.bailianRealtimeEnabled,/);
  assert.match(
    settingsHookSource,
    /setBailianRealtimeEnabled: store\.setBailianRealtimeEnabled,/
  );
});

test("Bailian transcription capsule exposes a realtime toggle without creating a separate provider", async () => {
  const [transcriptionSource, settingsPageSource] = await Promise.all([
    readRepoFile("src/components/TranscriptionModelPicker.tsx"),
    readRepoFile("src/components/SettingsPage.tsx"),
  ]);

  assert.match(transcriptionSource, /bailianRealtimeEnabled\??: boolean;/);
  assert.match(
    transcriptionSource,
    /setBailianRealtimeEnabled\??: \(enabled: boolean\) => void;/
  );
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "bailian"[\s\S]*?<Toggle[\s\S]*checked=\{bailianRealtimeEnabled\}[\s\S]*setBailianRealtimeEnabled/
  );
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "bailian"[\s\S]*transcription\.bailian\.realtimeLabel/
  );
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "bailian"[\s\S]*transcription\.bailian\.realtimeEnabledDescription/
  );
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "bailian"[\s\S]*transcription\.bailian\.realtimeDisabledDescription/
  );

  assert.match(
    settingsPageSource,
    /<TranscriptionModelPicker[\s\S]*bailianApiKey=\{bailianApiKey\}[\s\S]*bailianRealtimeEnabled=\{bailianRealtimeEnabled\}[\s\S]*setBailianRealtimeEnabled=\{setBailianRealtimeEnabled\}/
  );
});

test("Bailian realtime locale keys exist across every supported translation file", async () => {
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
    const parsed = JSON.parse(source);
    assert.equal(typeof parsed?.transcription?.bailian?.realtimeLabel, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.realtimeEnabledDescription, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.realtimeDisabledDescription, "string");
  }
});

test("audio manager routes Bailian realtime separately from Bailian batch transcription", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /STREAMING_PROVIDERS[\s\S]*bailian:/);
  assert.match(source, /bailianRealtimeWarmup/);
  assert.match(source, /bailianRealtimeStart/);
  assert.match(source, /bailianRealtimeSend/);
  assert.match(source, /bailianRealtimeFinalize/);
  assert.match(source, /bailianRealtimeStop/);
  assert.match(source, /bailianRealtimeStatus/);
  assert.match(source, /isByokBailianStreamingEnabled\(\)/);
  assert.match(
    source,
    /getBatchTranscriptionModel\(\) \{[\s\S]*if \(provider === "bailian"\) return "qwen3-asr-flash";/
  );
  assert.match(
    source,
    /getRealtimeStreamingModel\(\) \{[\s\S]*if \(provider === "bailian" && s\.bailianRealtimeEnabled\) return "qwen3-asr-flash-realtime";/
  );
  assert.match(
    source,
    /getStreamingRequestOptions\(\) \{[\s\S]*this\.isByokBailianStreamingEnabled\(\)[\s\S]*model: this\.getRealtimeStreamingModel\(\)/
  );
  assert.match(source, /shouldUseStreaming\(isSignedInOverride\) \{[\s\S]*this\.isByokBailianStreamingEnabled\(\)/);
  assert.match(
    source,
    /const isByokBailianStreaming = this\.isByokBailianStreamingEnabled\(\);/
  );
});

test("main-process bridge exposes Bailian realtime IPC and dedicated realtime helper", async () => {
  const [preloadSource, ipcHandlersSource, electronTypes, realtimeHelperSource] =
    await Promise.all([
      readRepoFile("preload.js"),
      readRepoFile("src/helpers/ipcHandlers.js"),
      readRepoFile("src/types/electron.ts"),
      readRepoFile("src/helpers/qwenRealtimeStreaming.js"),
    ]);

  assert.match(preloadSource, /bailianRealtimeWarmup/);
  assert.match(preloadSource, /bailianRealtimeStart/);
  assert.match(preloadSource, /bailianRealtimeSend/);
  assert.match(preloadSource, /bailianRealtimeFinalize/);
  assert.match(preloadSource, /bailianRealtimeStop/);
  assert.match(preloadSource, /bailianRealtimeStatus/);
  assert.match(preloadSource, /onBailianRealtimePartialTranscript/);
  assert.match(preloadSource, /onBailianRealtimeFinalTranscript/);
  assert.match(preloadSource, /onBailianRealtimeError/);
  assert.match(preloadSource, /onBailianRealtimeSessionEnd/);

  assert.match(ipcHandlersSource, /const QwenRealtimeStreaming = require\("\.\/qwenRealtimeStreaming"\);/);
  assert.match(ipcHandlersSource, /this\.bailianRealtimeStreaming = null;/);
  assert.match(ipcHandlersSource, /"bailian-realtime-warmup"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-start"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-send"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-finalize"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-stop"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-status"/);

  assert.match(electronTypes, /bailianRealtimeWarmup/);
  assert.match(electronTypes, /bailianRealtimeStart/);
  assert.match(electronTypes, /bailianRealtimeSend/);
  assert.match(electronTypes, /bailianRealtimeFinalize/);
  assert.match(electronTypes, /bailianRealtimeStop/);
  assert.match(electronTypes, /bailianRealtimeStatus/);
  assert.match(electronTypes, /onBailianRealtimePartialTranscript/);
  assert.match(electronTypes, /onBailianRealtimeFinalTranscript/);
  assert.match(electronTypes, /onBailianRealtimeError/);
  assert.match(electronTypes, /onBailianRealtimeSessionEnd/);

  assert.match(
    realtimeHelperSource,
    /wss:\/\/dashscope\.aliyuncs\.com\/api-ws\/v1\/realtime\?model=qwen3-asr-flash-realtime/
  );
  assert.match(realtimeHelperSource, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(realtimeHelperSource, /"session\.update"/);
  assert.match(realtimeHelperSource, /"input_audio_buffer\.append"/);
  assert.match(realtimeHelperSource, /"input_audio_buffer\.commit"/);
  assert.match(realtimeHelperSource, /"session\.finish"/);
  assert.match(realtimeHelperSource, /conversation\.item\.input_audio_transcription\.text/);
  assert.match(realtimeHelperSource, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(realtimeHelperSource, /text.*stash|stash.*text/);
});
