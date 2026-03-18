import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = "/Users/mac/Downloads/Projects/AICode/Mouthpiece/.worktrees/soniox-provider";

const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("transcription picker exposes Soniox as a first-class provider with dedicated controls", () => {
  const source = read("src/components/TranscriptionModelPicker.tsx");

  assert.match(source, /id: "soniox"/);
  assert.match(source, /sonioxApiKey/);
  assert.match(source, /setSonioxApiKey/);
  assert.match(source, /sonioxRealtimeEnabled/);
  assert.match(source, /setSonioxRealtimeEnabled/);
});

test("settings page passes Soniox settings into the transcription picker", () => {
  const source = read("src/components/SettingsPage.tsx");

  assert.match(source, /sonioxApiKey/);
  assert.match(source, /setSonioxApiKey/);
  assert.match(source, /sonioxRealtimeEnabled/);
  assert.match(source, /setSonioxRealtimeEnabled/);
  assert.match(source, /<TranscriptionModelPicker[\s\S]*sonioxApiKey=/);
});

test("settings store persists Soniox API key and realtime toggle", () => {
  const source = read("src/stores/settingsStore.ts");

  assert.match(source, /sonioxApiKey/);
  assert.match(source, /setSonioxApiKey/);
  assert.match(source, /sonioxRealtimeEnabled/);
  assert.match(source, /setSonioxRealtimeEnabled/);
});

test("useSettings exposes Soniox transcription settings", () => {
  const source = read("src/hooks/useSettings.ts");

  assert.match(source, /sonioxApiKey/);
  assert.match(source, /setSonioxApiKey/);
  assert.match(source, /sonioxRealtimeEnabled/);
  assert.match(source, /setSonioxRealtimeEnabled/);
});

test("dictation overlay is wired to show live partial transcript text", () => {
  const source = read("src/App.jsx");

  assert.match(source, /partialTranscript/);
  assert.match(source, /secondaryLabel/);
  assert.match(source, /<DictationCapsule[\s\S]*secondaryLabel=/);
});
