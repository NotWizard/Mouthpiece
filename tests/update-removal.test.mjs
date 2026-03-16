import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("main process and preload no longer expose updater wiring", async () => {
  const [mainSource, preloadSource, ipcSource] = await Promise.all([
    readRepoFile("main.js"),
    readRepoFile("preload.js"),
    readRepoFile("src/helpers/ipcHandlers.js"),
  ]);

  assert.doesNotMatch(mainSource, /UpdateManager/);
  assert.doesNotMatch(mainSource, /checkForUpdatesOnStartup/);
  assert.doesNotMatch(preloadSource, /checkForUpdates/);
  assert.doesNotMatch(preloadSource, /downloadUpdate/);
  assert.doesNotMatch(preloadSource, /installUpdate/);
  assert.doesNotMatch(preloadSource, /getUpdateStatus/);
  assert.doesNotMatch(preloadSource, /getUpdateInfo/);
  assert.doesNotMatch(preloadSource, /onUpdateAvailable/);
  assert.doesNotMatch(ipcSource, /this\.updateManager/);
  assert.doesNotMatch(ipcSource, /check-for-updates/);
  assert.doesNotMatch(ipcSource, /download-update/);
  assert.doesNotMatch(ipcSource, /install-update/);
  assert.doesNotMatch(ipcSource, /get-update-status/);
  assert.doesNotMatch(ipcSource, /get-update-info/);
});

test("renderer no longer offers update actions", async () => {
  const [controlPanelSource, settingsPageSource, packageJson, builderConfig] = await Promise.all([
    readRepoFile("src/components/ControlPanel.tsx"),
    readRepoFile("src/components/SettingsPage.tsx"),
    readRepoFile("package.json"),
    readRepoFile("electron-builder.json"),
  ]);

  assert.doesNotMatch(controlPanelSource, /useUpdater/);
  assert.doesNotMatch(controlPanelSource, /handleUpdateClick/);
  assert.doesNotMatch(controlPanelSource, /updateAction=/);

  assert.doesNotMatch(settingsPageSource, /useUpdater/);
  assert.doesNotMatch(settingsPageSource, /settingsPage\.general\.updates/);
  assert.match(settingsPageSource, /getAppVersion/);

  assert.doesNotMatch(packageJson, /"electron-updater"/);
  assert.doesNotMatch(builderConfig, /src\/updater\.js/);
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
