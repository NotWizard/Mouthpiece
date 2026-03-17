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
