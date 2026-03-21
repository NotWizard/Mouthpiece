import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("settings page wires the post-processing strategy card to strategy settings", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.match(source, /PostProcessingStrategyCard/);
  assert.match(source, /defaultOutputStrategy/);
  assert.match(source, /setDefaultOutputStrategy/);
});
