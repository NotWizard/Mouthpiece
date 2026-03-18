import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("Escape handling cancels active processing before closing the dictation window", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "src/App.jsx"), "utf8");

  assert.match(source, /if \(isRecording\)\s*\{\s*cancelRecording\(\);\s*return;\s*\}/s);
  assert.match(
    source,
    /if \((?:isTranscribing \|\| isProcessing|isProcessing \|\| isTranscribing)\)\s*\{\s*cancelProcessing\(\);\s*return;\s*\}/s
  );
});

test("dictation overlay keeps busy-mode visuals and input capture during processing-only stages", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "src/App.jsx"), "utf8");

  assert.match(
    source,
    /const capsuleIsBusy = (?:isTranscribing \|\| isProcessing|isProcessing \|\| isTranscribing);/
  );
  assert.match(source, /const shouldCaptureWindowInput = shouldCaptureDictationWindowInput\(\{/);
  assert.match(source, /if \(shouldCaptureWindowInput\)\s*\{\s*setWindowInteractivity\(true\);\s*\}/s);
  assert.match(source, /isTranscribing=\{capsuleIsBusy\}/);
});

test("streaming cancellation suppresses completion delivery after processing has been cancelled", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/audioManager.js"),
    "utf8"
  );

  assert.match(
    source,
    /const shouldStopBeforeCompletion = \(stage\) => \{[\s\S]*if \(this\.isProcessing\)\s*\{\s*return false;\s*\}/s
  );
  assert.match(
    source,
    /if \(shouldStopBeforeCompletion\("before-completion-delivery"\)\)\s*\{\s*return true;\s*\}[\s\S]*this\.onTranscriptionComplete\?\.\(\{\s*success: true,\s*text: finalText/s
  );
});
