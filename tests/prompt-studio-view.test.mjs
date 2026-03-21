import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("prompt studio view tab keeps a single cleanup quick lane without descriptive copy", async () => {
  const source = await readRepoFile("src/components/ui/PromptStudio.tsx");

  assert.match(source, /promptStudio\.view\.modes\.cleanup\.label/);
  assert.doesNotMatch(source, /promptStudio\.view\.modes\.cleanup\.description/);
});
