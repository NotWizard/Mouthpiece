import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("main process and preload expose updater wiring", async () => {
  const [mainSource, preloadSource, ipcSource] = await Promise.all([
    readRepoFile("main.js"),
    readRepoFile("preload.js"),
    readRepoFile("src/helpers/ipcHandlers.js"),
  ]);

  assert.match(mainSource, /const UpdateManager = require\("\.\/src\/helpers\/updateManager"\);/);
  assert.match(mainSource, /let updateManager = null;/);
  assert.match(mainSource, /updateManager = new UpdateManager\(/);
  assert.match(mainSource, /updateManager\.start\(\);/);

  assert.match(preloadSource, /getUpdateStatus: \(\) => ipcRenderer\.invoke\("get-update-status"\)/);
  assert.match(preloadSource, /installUpdate: \(\) => ipcRenderer\.invoke\("install-update"\)/);
  assert.match(
    preloadSource,
    /onUpdateStatusChanged:\s*registerListener\(\s*"update-status-changed"/
  );

  assert.match(ipcSource, /ipcMain\.handle\("get-update-status"/);
  assert.match(ipcSource, /ipcMain\.handle\("install-update"/);
  assert.match(ipcSource, /broadcastToWindows\("update-status-changed"/);
});

test("renderer control panel shows a confirmed install action for downloaded updates", async () => {
  const [controlPanelSource, sidebarSource, packageJson] = await Promise.all([
    readRepoFile("src/components/ControlPanel.tsx"),
    readRepoFile("src/components/ControlPanelSidebar.tsx"),
    readRepoFile("package.json"),
  ]);

  assert.match(controlPanelSource, /window\.electronAPI\?\.getUpdateStatus\?\.\(\)/);
  assert.match(controlPanelSource, /window\.electronAPI\?\.onUpdateStatusChanged\?\.\(/);
  assert.match(controlPanelSource, /window\.electronAPI\?\.installUpdate\?\.\(\)/);
  assert.match(
    controlPanelSource,
    /showConfirmDialog\(\{[\s\S]*title: t\("controlPanel\.update\.installTitle"\)[\s\S]*description: t\("controlPanel\.update\.installDescription"\)[\s\S]*confirmText: t\("controlPanel\.update\.installButton"\)/
  );
  assert.match(sidebarSource, /updateAction\?: \{/);
  assert.match(sidebarSource, /t\("controlPanel\.update\.availableButton"\)/);

  assert.match(packageJson, /"electron-updater"/);
});

test("renderer prompts to install once an update finishes downloading", async () => {
  const controlPanelSource = await readRepoFile("src/components/ControlPanel.tsx");

  assert.match(
    controlPanelSource,
    /updateStatus\?\.status !== "downloaded"[\s\S]*promptedDownloadedUpdateRef[\s\S]*showConfirmDialog\(\{[\s\S]*title: t\("controlPanel\.update\.readyTitle"\)[\s\S]*description: t\("controlPanel\.update\.readyDescription"\)[\s\S]*confirmText: t\("controlPanel\.update\.installButton"\)/,
  );
});

test("renderer exposes a manual update check entry point in preload, IPC, and settings UI", async () => {
  const [preloadSource, ipcSource, controlPanelSource, settingsPageSource, typesSource] =
    await Promise.all([
      readRepoFile("preload.js"),
      readRepoFile("src/helpers/ipcHandlers.js"),
      readRepoFile("src/components/ControlPanel.tsx"),
      readRepoFile("src/components/SettingsPage.tsx"),
      readRepoFile("src/types/electron.ts"),
    ]);

  assert.match(preloadSource, /checkForUpdates: \(\) => ipcRenderer\.invoke\("check-for-updates"\)/);
  assert.match(ipcSource, /ipcMain\.handle\("check-for-updates"/);
  assert.match(controlPanelSource, /onCheckForUpdates=\{handleManualCheckForUpdates\}/);
  assert.match(settingsPageSource, /t\("settingsModal\.updates\.checkForUpdates"\)/);
  assert.match(typesSource, /checkForUpdates\?: \(\) => Promise<AppUpdateStatus>/);
});

test("privacy settings no longer expose usage analytics sharing", async () => {
  const [settingsPageSource, settingsHookSource, settingsStoreSource, enTranslations] =
    await Promise.all([
      readRepoFile("src/components/SettingsPage.tsx"),
      readRepoFile("src/hooks/useSettings.ts"),
      readRepoFile("src/stores/settingsStore.ts"),
      readRepoFile("src/locales/en/translation.json"),
    ]);

  assert.doesNotMatch(settingsPageSource, /usageAnalytics/);
  assert.doesNotMatch(settingsPageSource, /telemetryEnabled/);
  assert.doesNotMatch(settingsHookSource, /telemetryEnabled/);
  assert.doesNotMatch(settingsHookSource, /setTelemetryEnabled/);
  assert.doesNotMatch(settingsStoreSource, /telemetryEnabled/);
  assert.doesNotMatch(settingsStoreSource, /setTelemetryEnabled/);
  assert.doesNotMatch(enTranslations, /Usage analytics/);
  assert.doesNotMatch(enTranslations, /analytics/);
});
