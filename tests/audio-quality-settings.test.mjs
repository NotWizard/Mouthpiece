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

test("audio quality settings default to noise reduction and sanitize invalid values", async () => {
  const mod = await loadAudioQualitySettings();

  assert.equal(mod.DEFAULT_AUDIO_QUALITY_MODE, "noise_reduction");
  assert.equal(mod.DEFAULT_VOICE_GATE_STRICTNESS, "standard");
  assert.equal(mod.DEFAULT_REALTIME_ENDPOINTING_MODE, "balanced");
  assert.equal(mod.normalizeAudioQualityMode("balanced"), "balanced");
  assert.equal(mod.normalizeAudioQualityMode("unknown"), "noise_reduction");
  assert.equal(mod.normalizeVoiceGateStrictness("strict"), "strict");
  assert.equal(mod.normalizeVoiceGateStrictness("unknown"), "standard");
  assert.equal(mod.normalizeRealtimeEndpointingMode("patient"), "patient");
  assert.equal(mod.normalizeRealtimeEndpointingMode("unknown"), "balanced");
});

test("audio quality mode maps to microphone constraints and gate thresholds", async () => {
  const mod = await loadAudioQualitySettings();

  assert.deepEqual(mod.getAudioProcessingConstraints("noise_reduction"), {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: false },
  });
  assert.deepEqual(mod.getAudioProcessingConstraints("low_latency"), {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  });

  const strict = mod.getVoiceGateConfig({
    audioQualityMode: "noise_reduction",
    voiceGateStrictness: "strict",
  });
  const relaxed = mod.getVoiceGateConfig({
    audioQualityMode: "low_latency",
    voiceGateStrictness: "relaxed",
  });

  assert.equal(strict.minSpeechMs > relaxed.minSpeechMs, true);
  assert.equal(strict.openSnrDb > relaxed.openSnrDb, true);
  assert.equal(strict.minVoicedRatio > relaxed.minVoicedRatio, true);
});

test("settings store and hook expose audio quality controls", async () => {
  const [settingsStoreSource, settingsHookSource] = await Promise.all([
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/hooks/useSettings.ts"),
  ]);

  assert.match(settingsStoreSource, /audioQualityMode: normalizeAudioQualityMode/);
  assert.match(settingsStoreSource, /voiceGateStrictness: normalizeVoiceGateStrictness/);
  assert.match(settingsStoreSource, /realtimeEndpointingMode: normalizeRealtimeEndpointingMode/);
  assert.match(settingsStoreSource, /setAudioQualityMode: createAudioQualityModeSetter/);
  assert.match(settingsStoreSource, /setVoiceGateStrictness: createVoiceGateStrictnessSetter/);
  assert.match(
    settingsStoreSource,
    /setRealtimeEndpointingMode: createRealtimeEndpointingModeSetter/
  );

  assert.match(settingsHookSource, /audioQualityMode: AudioQualityMode;/);
  assert.match(settingsHookSource, /voiceGateStrictness: VoiceGateStrictness;/);
  assert.match(settingsHookSource, /realtimeEndpointingMode: RealtimeEndpointingMode;/);
  assert.match(settingsHookSource, /setAudioQualityMode: store\.setAudioQualityMode,/);
  assert.match(settingsHookSource, /setVoiceGateStrictness: store\.setVoiceGateStrictness,/);
  assert.match(
    settingsHookSource,
    /setRealtimeEndpointingMode: store\.setRealtimeEndpointingMode,/
  );
});

test("control panel exposes audio quality UI without hardcoded labels", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.match(source, /function AudioQualitySettingsCard/);
  assert.match(source, /settingsPage\.transcription\.audioQuality\.title/);
  assert.match(source, /settingsPage\.transcription\.audioQuality\.advancedTitle/);
  assert.match(source, /AudioQualityCompactSelect/);
  assert.doesNotMatch(source, /SettingsPanelRow className="space-y-3"/);
  assert.match(source, /audioQualityMode=\{audioQualityMode\}/);
  assert.match(source, /setAudioQualityMode=\{setAudioQualityMode\}/);
  assert.match(source, /voiceGateStrictness=\{voiceGateStrictness\}/);
  assert.match(source, /realtimeEndpointingMode=\{realtimeEndpointingMode\}/);
});

test("microphone input test reserves stable space for dynamic status text", async () => {
  const source = await readRepoFile("src/components/ui/MicrophoneSettings.tsx");

  assert.match(source, /MIC_TEST_STATUS_CARD_CLASS/);
  assert.match(source, /MIC_TEST_DYNAMIC_TEXT_CLASS/);
  assert.match(source, /tabular-nums/);
  assert.match(source, /lastInputStatusUpdateRef/);
  assert.match(source, /INPUT_STATUS_UPDATE_INTERVAL_MS/);
});

test("audio manager applies capture constraints and gates realtime frames before provider send", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /getAudioProcessingConstraints/);
  assert.match(source, /getSpeechActivityGateConfig/);
  assert.match(source, /advanceSpeechActivityGate/);
  assert.match(source, /createSilenceFrameLike/);
  assert.match(source, /audioQualityMode/);
  assert.match(source, /voiceGateStrictness/);
  assert.match(source, /noiseSuppression: settings\.noiseSuppression/);
  assert.match(source, /this\.speechActivityGateState/);
  assert.match(source, /this\.speechActivityGateConfig/);
  assert.match(source, /const gateResult = advanceSpeechActivityGate/);
  assert.match(source, /provider\.send\(frame\.samples\)/);
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

test("audio quality locale keys exist across every supported translation file", async () => {
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
    assert.match(source, /"audioQuality": \{/);
    assert.match(source, /"noise_reduction": \{/);
    assert.match(source, /"balanced": \{/);
    assert.match(source, /"low_latency": \{/);
    assert.match(source, /"voiceGateStrictness": \{/);
    assert.match(source, /"realtimeEndpointing": \{/);
    assert.match(source, /"inputTest": \{/);
  }
});
