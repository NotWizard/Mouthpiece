import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("AI processing wires the terminology settings card to profile review actions", async () => {
  const [settingsSource, dictionarySource] = await Promise.all([
    readRepoFile("src/components/SettingsPage.tsx"),
    readRepoFile("src/components/DictionaryView.tsx"),
  ]);

  assert.match(settingsSource, /case "intelligence":[\s\S]*?TerminologySettingsCard/);
  assert.match(settingsSource, /terminologyProfile/);
  assert.doesNotMatch(dictionarySource, /TerminologySettingsCard/);
});
