import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("Qwen ASR is registered as a local transcription provider with both MLX models", async () => {
  const [typesSource, registrySource, settingsStoreSource] = await Promise.all([
    readRepoFile("src/types/electron.ts"),
    readRepoFile("src/models/modelRegistryData.json"),
    readRepoFile("src/stores/settingsStore.ts"),
  ]);

  assert.match(
    typesSource,
    /export type LocalTranscriptionProvider = "whisper" \| "nvidia" \| "qwen";/
  );
  assert.match(registrySource, /"qwenAsrModels": \{/);
  assert.match(registrySource, /"qwen3-asr-0\.6b-mlx"/);
  assert.match(registrySource, /"qwen3-asr-1\.7b-mlx"/);
  assert.match(
    settingsStoreSource,
    /qwenAsrModel: readString\("qwenAsrModel", "qwen3-asr-0\.6b-mlx"\)/
  );
  assert.match(settingsStoreSource, /setQwenAsrModel: createStringSetter\("qwenAsrModel"\)/);
});

test("startup preference sync persists and clears Qwen ASR prewarm state", async () => {
  const [settingsHookSource, ipcSource, mainSource] = await Promise.all([
    readRepoFile("src/hooks/useSettings.ts"),
    readRepoFile("src/helpers/ipcHandlers.js"),
    readRepoFile("main.js"),
  ]);

  assert.match(settingsHookSource, /localTranscriptionProvider === "qwen"\s*\?\s*qwenAsrModel/);
  assert.match(ipcSource, /setVars\.QWEN_ASR_MODEL = prefs\.model/);
  assert.match(ipcSource, /clearVars\.push\("PARAKEET_MODEL", "LOCAL_WHISPER_MODEL"\)/);
  assert.match(ipcSource, /this\.qwenAsrManager\.stopServer\(\)/);
  assert.match(mainSource, /const QwenAsrManager = require\("\.\/src\/helpers\/qwenAsr"\)/);
  assert.match(mainSource, /qwenAsrManager\.initializeAtStartup\(qwenAsrSettings\)/);
});

test("Qwen ASR IPC and preload APIs mirror existing local model operations", async () => {
  const [preloadSource, ipcSource, electronTypesSource] = await Promise.all([
    readRepoFile("preload.js"),
    readRepoFile("src/helpers/ipcHandlers.js"),
    readRepoFile("src/types/electron.ts"),
  ]);

  for (const apiName of [
    "transcribeLocalQwenAsr",
    "checkQwenAsrInstallation",
    "installQwenAsrRuntime",
    "downloadQwenAsrModel",
    "listQwenAsrModels",
    "deleteQwenAsrModel",
    "cancelQwenAsrDownload",
    "qwenAsrServerStart",
    "qwenAsrServerStop",
    "qwenAsrServerStatus",
    "getQwenAsrDiagnostics",
  ]) {
    assert.match(preloadSource, new RegExp(apiName));
    assert.match(electronTypesSource, new RegExp(apiName));
  }

  for (const channelName of [
    "transcribe-local-qwen-asr",
    "check-qwen-asr-installation",
    "install-qwen-asr-runtime",
    "download-qwen-asr-model",
    "list-qwen-asr-models",
    "delete-qwen-asr-model",
    "cancel-qwen-asr-download",
    "qwen-asr-server-start",
    "qwen-asr-server-stop",
    "qwen-asr-server-status",
    "get-qwen-asr-diagnostics",
  ]) {
    assert.match(ipcSource, new RegExp(channelName));
  }
});

test("audio manager routes local Qwen ASR through a dedicated MLX pipeline", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /localProvider === "qwen"/);
  assert.match(source, /processWithLocalQwenAsr/);
  assert.match(source, /window\.electronAPI\.transcribeLocalQwenAsr/);
  assert.match(source, /source: "local-qwen-asr"/);
});

test("transcription picker exposes Qwen ASR MLX provider and runtime installation flow", async () => {
  const source = await readRepoFile("src/components/TranscriptionModelPicker.tsx");

  assert.match(source, /Qwen ASR \(MLX\)/);
  assert.match(source, /QWEN_ASR_MODEL_INFO/);
  assert.match(source, /installQwenAsrRuntime/);
  assert.match(source, /renderQwenAsrModels/);
  assert.match(source, /getCachedPlatform\(\) !== "darwin"/);
});

test("Qwen ASR manager modules expose platform, runtime, server, and model lifecycle behavior", async () => {
  const [managerSource, serverSource] = await Promise.all([
    readRepoFile("src/helpers/qwenAsr.js"),
    readRepoFile("src/helpers/qwenAsrServer.js"),
  ]);

  assert.match(managerSource, /process\.platform === "darwin" && process\.arch === "arm64"/);
  assert.match(managerSource, /qwen-asr-runtime/);
  assert.match(managerSource, /qwen-asr-models/);
  assert.match(managerSource, /installRuntime/);
  assert.match(managerSource, /downloadQwenAsrModel/);
  assert.match(serverSource, /mlx-qwen3-asr/);
  assert.match(serverSource, /\/v1\/audio\/transcriptions/);
  assert.match(serverSource, /Bearer/);
  assert.match(serverSource, /startServer/);
});

test("Qwen ASR UI strings exist across every supported translation file", async () => {
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
    assert.match(source, /"qwenAsr": \{/);
    assert.match(source, /"installRuntime"/);
    assert.match(source, /"runtimeUnavailable"/);
    assert.match(source, /"appleSiliconOnly"/);
  }
});
