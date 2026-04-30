import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("secondary control panel views use a shared padded content wrapper", async () => {
  const source = await readRepoFile("src/components/ControlPanel.tsx");

  assert.match(source, /const SIDEBAR_VIEW_CONTENT_CLASS_NAME = "control-panel-view-content";/);
  assert.match(
    source,
    /activeView === "dictionary"[\s\S]*?<div className=\{SIDEBAR_VIEW_CONTENT_CLASS_NAME\}>[\s\S]*?<DictionaryView \/>/
  );
  assert.match(
    source,
    /\(activeView === "general"[\s\S]*?<div className=\{SIDEBAR_VIEW_CONTENT_CLASS_NAME\}>[\s\S]*?<SettingsPage[\s\S]*?activeSection=\{activeView\}[\s\S]*?\/>/
  );
});
