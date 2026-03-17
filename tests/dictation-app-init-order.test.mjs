import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("App initializes recording state before any effect reads isRecording", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "src/App.jsx"), "utf8");

  const recordingHookIndex = source.indexOf("} = useAudioRecording(toast, {");
  const firstRecordingEffectIndex = source.indexOf("useEffect(() => {\n    if (isRecording || isCommandMenuOpen || toastCount > 0) {");

  assert.notEqual(recordingHookIndex, -1);
  assert.notEqual(firstRecordingEffectIndex, -1);
  assert.ok(
    recordingHookIndex < firstRecordingEffectIndex,
    "useAudioRecording must run before effects read isRecording"
  );
});
