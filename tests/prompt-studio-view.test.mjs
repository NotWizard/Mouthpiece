import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("prompt studio view tab removes the cleanup quick lane and keeps the prompt content area", async () => {
  const source = await readRepoFile("src/components/ui/PromptStudio.tsx");

  assert.doesNotMatch(source, /promptStudio\.view\.modes\.cleanup\.label/);
  assert.match(source, /promptStudio\.view\.customPrompt/);
  assert.match(source, /promptStudio\.view\.defaultPrompt/);
  assert.match(source, /getCurrentPrompt\(\)\.replace/);
});
