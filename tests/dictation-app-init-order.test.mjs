import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("App initializes recording state before any effect reads isRecording", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "src/App.jsx"), "utf8");

  const recordingHookMatch = /}\s*=\s*useAudioRecording\([^)]*,\s*\{/.exec(source);
  const recordingHookIndex = recordingHookMatch?.index ?? -1;
  const activityDerivationIndex = source.indexOf(
    "const shouldCaptureWindowInput = shouldCaptureDictationWindowInput({"
  );
  const firstRecordingEffectIndex = source.indexOf(
    "useEffect(() => {\n    if (shouldCaptureWindowInput) {"
  );

  assert.notEqual(recordingHookIndex, -1);
  assert.notEqual(activityDerivationIndex, -1);
  assert.notEqual(firstRecordingEffectIndex, -1);
  assert.ok(
    recordingHookIndex < activityDerivationIndex,
    "useAudioRecording must run before derived dictation activity state is computed"
  );
  assert.ok(
    recordingHookIndex < firstRecordingEffectIndex,
    "useAudioRecording must run before effects read isRecording"
  );
});
