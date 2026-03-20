import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadAccessibilityRepairModule() {
  try {
    return require(path.resolve(process.cwd(), "src/helpers/accessibilityRepair.js"));
  } catch {
    return {};
  }
}

test("macOS accessibility repair resets the Mouthpiece TCC entry before reopening Accessibility settings", () => {
  const mod = loadAccessibilityRepairModule();

  assert.equal(typeof mod.buildMacOSAccessibilityResetCommand, "function");
  assert.deepEqual(mod.buildMacOSAccessibilityResetCommand(), {
    command: "tccutil",
    args: ["reset", "Accessibility", "com.mouthpiece.app"],
  });
});

test("permissions hook re-syncs live macOS accessibility state on mount and when the app regains focus", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/hooks/usePermissions.ts"),
    "utf8"
  );

  assert.match(source, /promptOnFailure:\s*false/);
  assert.match(source, /bypassCache:\s*true/);
  assert.match(source, /window\.addEventListener\("focus",/);
  assert.match(source, /document\.addEventListener\("visibilitychange",/);
  assert.match(source, /setAccessibilityPermissionGranted\(Boolean\(granted\)\)/);
});

test("settings troubleshooting invokes the reset flow through preload and IPC instead of only opening System Settings", async () => {
  const [settingsSource, preloadSource, ipcSource, typesSource] = await Promise.all([
    fs.readFile(path.resolve(process.cwd(), "src/components/SettingsPage.tsx"), "utf8"),
    fs.readFile(path.resolve(process.cwd(), "preload.js"), "utf8"),
    fs.readFile(path.resolve(process.cwd(), "src/helpers/ipcHandlers.js"), "utf8"),
    fs.readFile(path.resolve(process.cwd(), "src/types/electron.ts"), "utf8"),
  ]);

  assert.match(settingsSource, /permissionsHook\.resetAccessibilityPermissions\(\)/);
  assert.match(
    preloadSource,
    /resetAccessibilityPermissions:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("reset-accessibility-permissions"\)/
  );
  assert.match(ipcSource, /ipcMain\.handle\("reset-accessibility-permissions"/);
  assert.match(typesSource, /resetAccessibilityPermissions\?: \(\) => Promise<\{ success: boolean; error\?: string \}>;/);
});
