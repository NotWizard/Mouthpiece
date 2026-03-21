import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("settings page no longer renders a post-processing strategy card", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.doesNotMatch(source, /PostProcessingStrategyCard/);
  assert.doesNotMatch(source, /defaultOutputStrategy/);
  assert.doesNotMatch(source, /setDefaultOutputStrategy/);
  assert.match(source, /PromptStudio/);
});
