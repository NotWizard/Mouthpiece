import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("sidebar account state helper exports a default object for the sidebar import", async () => {
  const [sidebarSource, helperSource] = await Promise.all([
    readRepoFile("src/components/ControlPanelSidebar.tsx"),
    readRepoFile("src/utils/sidebarAccountState.js"),
  ]);

  assert.match(
    sidebarSource,
    /import sidebarAccountState from "\.\.\/utils\/sidebarAccountState";/
  );
  assert.match(helperSource, /export default\s+\{\s*shouldShowSidebarAccountSection,\s*\};/);
});

test("settings page reads cache path hints from a browser-safe helper", async () => {
  const [settingsSource, helperSource] = await Promise.all([
    readRepoFile("src/components/SettingsPage.tsx"),
    readRepoFile("src/utils/modelCachePathHint.ts"),
  ]);

  assert.match(
    settingsSource,
    /import\s+\{\s*getModelCachePathHint\s*\}\s+from "\.\.\/utils\/modelCachePathHint";/
  );
  assert.match(helperSource, /export function getModelCachePathHint/);
  assert.doesNotMatch(helperSource, /require\("fs"\)|require\("path"\)/);
});
