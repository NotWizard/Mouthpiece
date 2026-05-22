import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/ui/PromptStudio.tsx"),
  "utf8"
);

test("PromptStudio reads translation settings and renders banner when enabled", () => {
  assert.match(source, /translationEnabled\b/);
  assert.match(source, /translationTargetLang\b/);
  assert.match(source, /promptStudio\.translationBanner\.title/);
  assert.match(source, /promptStudio\.translationBanner\.copyButton/);
  assert.match(source, /\{\{TARGET_LANG_INSTRUCTION\}\}/);
});
