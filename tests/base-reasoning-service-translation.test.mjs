import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/services/BaseReasoningService.ts"),
  "utf8"
);

test("BaseReasoningService.getSystemPrompt forwards translation context", () => {
  assert.match(
    source,
    /getSystemPrompt\(\)\s*:\s*string\s*\{[\s\S]*?translationEnabled[\s\S]*?translationTargetLang/
  );
  assert.match(
    source,
    /getSystemPrompt\(\s*[\s\S]*?\{\s*enabled:\s*[\s\S]*?translationEnabled[\s\S]*?targetLang:\s*[\s\S]*?translationTargetLang[\s\S]*?\}\s*\)/
  );
});
