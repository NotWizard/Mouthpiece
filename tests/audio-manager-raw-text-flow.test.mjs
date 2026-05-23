import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/helpers/audioManager.js"),
  "utf8"
);

test("processTranscription returns an object containing finalText and rawText", () => {
  assert.match(
    source,
    /async\s+processTranscription\(text,\s*source,\s*withTranslation(?:\s*=\s*false)?\)\s*\{[\s\S]*?return\s*\{[\s\S]*?finalText[\s\S]*?rawText/,
    "processTranscription must return { finalText, rawText, ... }"
  );
});

test("saveTranscription forwards rawText to electronAPI", () => {
  assert.match(
    source,
    /async\s+saveTranscription\(text,\s*rawText\)\s*\{[\s\S]*?window\.electronAPI\.saveTranscription\(text,\s*rawText/
  );
});
