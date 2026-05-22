import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/ui/TranscriptionItem.tsx"),
  "utf8"
);

test("TranscriptionItem renders a <details> disclosure for raw_text when present", () => {
  assert.match(source, /item\.raw_text/);
  assert.match(source, /<details/);
  assert.match(source, /controlPanel\.history\.viewRawTranscript/);
});

test("TranscriptionItem hides the disclosure when raw_text is missing or equal to text", () => {
  assert.match(
    source,
    /item\.raw_text[\s\S]*?\.trim\(\)\s*!==\s*item\.text\.trim\(\)/
  );
});
