import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = "/Users/mac/Downloads/Projects/AICode/Mouthpiece/.worktrees/soniox-provider";

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("model registry exposes Soniox transcription provider and both official models", () => {
  const registry = JSON.parse(read("src/models/modelRegistryData.json"));
  const soniox = registry.transcriptionProviders.find((provider) => provider.id === "soniox");

  assert.ok(soniox, "expected a soniox transcription provider entry");
  assert.equal(soniox.baseUrl, "https://api.soniox.com/v1");
  assert.ok(
    soniox.models.some((model) => model.id === "stt-async-v4"),
    "expected Soniox async model stt-async-v4"
  );
  assert.ok(
    soniox.models.some((model) => model.id === "stt-rt-v4"),
    "expected Soniox realtime model stt-rt-v4"
  );
});

test("shared Soniox helper exists and exposes stream assembly primitives", () => {
  const helperPath = path.join(repoRoot, "src/helpers/sonioxShared.js");
  assert.ok(fs.existsSync(helperPath), "expected src/helpers/sonioxShared.js to exist");

  const helperSource = read("src/helpers/sonioxShared.js");
  assert.match(helperSource, /buildSonioxRealtimeConfig/);
  assert.match(helperSource, /selectSonioxModel/);
  assert.match(helperSource, /accumulateSonioxTokens/);
  assert.match(helperSource, /<fin>/);
});

test("audio manager contains Soniox-specific runtime routing hooks", () => {
  const source = read("src/helpers/audioManager.js");

  assert.match(source, /provider === "soniox"/);
  assert.match(source, /sonioxRealtimeEnabled/);
  assert.match(source, /processWithSonioxAsync/);
  assert.match(source, /STREAMING_PROVIDERS[\s\S]*soniox/);
});

test("main-process and preload layers expose Soniox streaming + async IPC", () => {
  const preloadSource = read("preload.js");
  const ipcSource = read("src/helpers/ipcHandlers.js");
  const electronTypes = read("src/types/electron.ts");

  assert.match(preloadSource, /sonioxStreamingWarmup/);
  assert.match(preloadSource, /sonioxStreamingStart/);
  assert.match(preloadSource, /sonioxStreamingSend/);
  assert.match(preloadSource, /sonioxStreamingFinalize/);
  assert.match(preloadSource, /sonioxStreamingStop/);
  assert.match(preloadSource, /proxySonioxTranscription/);

  assert.match(ipcSource, /soniox-streaming-warmup/);
  assert.match(ipcSource, /soniox-streaming-start/);
  assert.match(ipcSource, /soniox-streaming-send/);
  assert.match(ipcSource, /soniox-streaming-finalize/);
  assert.match(ipcSource, /soniox-streaming-stop/);
  assert.match(ipcSource, /proxy-soniox-transcription/);

  assert.match(electronTypes, /sonioxStreamingWarmup/);
  assert.match(electronTypes, /sonioxStreamingStart/);
  assert.match(electronTypes, /sonioxStreamingSend/);
  assert.match(electronTypes, /sonioxStreamingFinalize/);
  assert.match(electronTypes, /sonioxStreamingStop/);
  assert.match(electronTypes, /proxySonioxTranscription/);
});
