import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function loadAudioQualitySettings() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/audioQualitySettings.mjs")
  ).href;
  return import(modulePath);
}

test("audio quality settings expose a single hardcoded preset", async () => {
  const mod = await loadAudioQualitySettings();

  assert.deepEqual(mod.getAudioProcessingConstraints(), {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
  });

  const config = mod.getVoiceGateConfig();
  assert.equal(config.sampleRate, 16000);
  assert.equal(config.frameMs, 50);
  assert.equal(config.minSpeechRms, 0.014);
  assert.equal(config.openSnrDb, 10);
  assert.equal(config.minSpeechFrames, 4);

  assert.deepEqual(mod.getRealtimeEndpointingConfig("deepgram"), {
    endpointing: 500,
    utteranceEndMs: 1000,
  });
  assert.deepEqual(mod.getRealtimeEndpointingConfig("bailian"), {
    silenceDurationMs: 1200,
  });
  assert.deepEqual(mod.getRealtimeEndpointingConfig("unknown"), {});
});

test("microphone input test reserves stable space for dynamic status text", async () => {
  const source = await readRepoFile("src/components/ui/MicrophoneSettings.tsx");

  assert.match(source, /MIC_TEST_STATUS_CARD_CLASS/);
  assert.match(source, /MIC_TEST_DYNAMIC_TEXT_CLASS/);
  assert.match(source, /tabular-nums/);
  assert.match(source, /lastInputStatusUpdateRef/);
  assert.match(source, /INPUT_STATUS_UPDATE_INTERVAL_MS/);
});

test("microphone preferences expose device selection without built-in preference mode", async () => {
  const [
    settingsPageSource,
    microphoneSettingsSource,
    audioManagerSource,
    settingsHookSource,
    settingsStoreSource,
  ] = await Promise.all([
    readRepoFile("src/components/SettingsPage.tsx"),
    readRepoFile("src/components/ui/MicrophoneSettings.tsx"),
    readRepoFile("src/helpers/audioManager.js"),
    readRepoFile("src/hooks/useSettings.ts"),
    readRepoFile("src/stores/settingsStore.ts"),
  ]);

  assert.doesNotMatch(settingsPageSource, /preferBuiltInMic/);
  assert.doesNotMatch(settingsPageSource, /setPreferBuiltInMic/);
  assert.doesNotMatch(microphoneSettingsSource, /preferBuiltInMic/);
  assert.doesNotMatch(microphoneSettingsSource, /onPreferBuiltInChange/);
  assert.doesNotMatch(audioManagerSource, /preferBuiltInMic/);
  assert.doesNotMatch(settingsHookSource, /preferBuiltInMic/);
  assert.doesNotMatch(settingsHookSource, /setPreferBuiltInMic/);
  assert.doesNotMatch(settingsStoreSource, /preferBuiltInMic: readBoolean/);
  assert.doesNotMatch(settingsStoreSource, /setPreferBuiltInMic/);
  assert.match(settingsStoreSource, /localStorage\.removeItem\("preferBuiltInMic"\)/);
  assert.match(microphoneSettingsSource, /microphoneSettings\.inputDevice/);
  assert.match(microphoneSettingsSource, /selectedMicDeviceId \|\| "default"/);
});

test("audio manager applies capture constraints and gates realtime frames before provider send", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /getAudioProcessingConstraints/);
  assert.match(source, /getSpeechActivityGateConfig/);
  assert.match(source, /advanceSpeechActivityGate/);
  assert.match(source, /createSilenceFrameLike/);
  assert.match(source, /this\.speechActivityGateState/);
  assert.match(source, /this\.speechActivityGateConfig/);
  assert.match(source, /const gateResult = advanceSpeechActivityGate/);
  assert.match(source, /provider\.send\(frame\.samples\)/);
});

test("audio quality controls are no longer surfaced as user settings", async () => {
  const [
    audioQualitySource,
    settingsStoreSource,
    settingsHookSource,
    settingsPageSource,
    audioManagerSource,
  ] = await Promise.all([
    readRepoFile("src/utils/audioQualitySettings.mjs"),
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/hooks/useSettings.ts"),
    readRepoFile("src/components/SettingsPage.tsx"),
    readRepoFile("src/helpers/audioManager.js"),
  ]);

  for (const source of [audioQualitySource, settingsHookSource]) {
    assert.doesNotMatch(source, /AUDIO_QUALITY_MODES/);
    assert.doesNotMatch(source, /VOICE_GATE_STRICTNESS_LEVELS/);
    assert.doesNotMatch(source, /REALTIME_ENDPOINTING_MODES/);
    assert.doesNotMatch(source, /audioQualityMode/);
    assert.doesNotMatch(source, /voiceGateStrictness/);
    assert.doesNotMatch(source, /realtimeEndpointingMode/);
  }

  // settingsStore should no longer declare or expose these settings, but is
  // expected to keep `localStorage.removeItem` migration calls so existing
  // installs shed the legacy keys on next launch.
  assert.doesNotMatch(settingsStoreSource, /AUDIO_QUALITY_MODES/);
  assert.doesNotMatch(settingsStoreSource, /VOICE_GATE_STRICTNESS_LEVELS/);
  assert.doesNotMatch(settingsStoreSource, /REALTIME_ENDPOINTING_MODES/);
  assert.doesNotMatch(settingsStoreSource, /audioQualityMode:\s*readString/);
  assert.doesNotMatch(settingsStoreSource, /voiceGateStrictness:\s*readString/);
  assert.doesNotMatch(settingsStoreSource, /realtimeEndpointingMode:\s*readString/);
  assert.doesNotMatch(settingsStoreSource, /setAudioQualityMode/);
  assert.doesNotMatch(settingsStoreSource, /setVoiceGateStrictness/);
  assert.doesNotMatch(settingsStoreSource, /setRealtimeEndpointingMode/);
  assert.match(settingsStoreSource, /localStorage\.removeItem\("audioQualityMode"\)/);
  assert.match(settingsStoreSource, /localStorage\.removeItem\("voiceGateStrictness"\)/);
  assert.match(settingsStoreSource, /localStorage\.removeItem\("realtimeEndpointingMode"\)/);

  assert.doesNotMatch(settingsPageSource, /AudioQualitySettingsCard/);
  assert.doesNotMatch(settingsPageSource, /audioQuality\.title/);

  assert.doesNotMatch(audioManagerSource, /audioQualityMode/);
  assert.doesNotMatch(audioManagerSource, /voiceGateStrictness/);
  assert.doesNotMatch(audioManagerSource, /realtimeEndpointingMode/);
  assert.doesNotMatch(audioManagerSource, /low_latency/);
});

test("Bailian realtime sends raw frames to provider server VAD", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(
    source,
    /sendRealtimeFrameThroughSpeechActivityGate\(provider,\s*event\.data,\s*\{\s*providerName:\s*streamingProviderName,\s*\}\)/
  );
  assert.match(
    source,
    /providerName === "bailian"[\s\S]*provider\.send\(pcmFrame\);[\s\S]*return;/s
  );
});

test("streaming batch fallback uses realtime-specific toast copy", async () => {
  const hookSource = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(hookSource, /getFallbackToastDescription\(result,\s*t\)/);
  assert.match(hookSource, /hooks\.audioRecording\.streamingFallback\.description/);

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

  for (const file of localeFiles) {
    const parsed = JSON.parse(await readRepoFile(file));
    assert.equal(typeof parsed?.hooks?.audioRecording?.streamingFallback?.description, "string");
  }
});

test("audio quality locale subtree is removed from every supported translation file", async () => {
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

  for (const file of localeFiles) {
    const source = await readRepoFile(file);
    assert.doesNotMatch(source, /"audioQuality":\s*\{/);
    assert.doesNotMatch(source, /"voiceGateStrictness":\s*\{/);
    assert.doesNotMatch(source, /"realtimeEndpointing":\s*\{/);
  }
});
