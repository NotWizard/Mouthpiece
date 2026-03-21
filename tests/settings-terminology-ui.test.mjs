import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("dictionary view wires the terminology settings card to profile review actions", async () => {
  const source = await readRepoFile("src/components/DictionaryView.tsx");

  assert.match(source, /TerminologySettingsCard/);
  assert.match(source, /terminologyProfile/);
  assert.match(source, /approveTerminologySuggestion/);
  assert.match(source, /rejectTerminologySuggestion/);
});
