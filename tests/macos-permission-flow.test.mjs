import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

function loadPermissionFlowModule() {
  try {
    return require(path.resolve(process.cwd(), "src/helpers/macOSPermissionFlow.js"));
  } catch {
    return {};
  }
}

test("macOS permission flow resolves a stable app bundle and rejects bare Electron dev binaries", () => {
  const mod = loadPermissionFlowModule();

  assert.equal(typeof mod.resolveMacOSAppBundlePath, "function");

  assert.equal(
    mod.resolveMacOSAppBundlePath({
      platform: "darwin",
      env: { MOUTHPIECE_PERMISSION_APP_PATH: "/Applications/Mouthpiece.app" },
      fsExistsSync: (candidate) => candidate === "/Applications/Mouthpiece.app",
    }),
    "/Applications/Mouthpiece.app"
  );

  assert.equal(
    mod.resolveMacOSAppBundlePath({
      platform: "darwin",
      defaultApp: false,
      execPath: "/Applications/Mouthpiece.app/Contents/MacOS/Mouthpiece",
      fsExistsSync: (candidate) => candidate === "/Applications/Mouthpiece.app",
    }),
    "/Applications/Mouthpiece.app"
  );

  assert.equal(
    mod.resolveMacOSAppBundlePath({
      platform: "darwin",
      defaultApp: true,
      execPath:
        "/Users/dev/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      env: {},
      fsExistsSync: () => true,
    }),
    null
  );
});

test("macOS permission flow manager falls back instead of spawning when helper or app bundle is unavailable", () => {
  const mod = loadPermissionFlowModule();

  assert.equal(typeof mod.MacOSPermissionFlowManager, "function");

  const manager = new mod.MacOSPermissionFlowManager({
    platform: "darwin",
    defaultApp: true,
    env: {},
    execPath: "/Users/dev/project/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    resourcesPath: "/tmp/MouthpieceResources",
    fsExistsSync: () => false,
    spawn: () => {
      throw new Error("spawn should not run without prerequisites");
    },
  });

  const result = manager.start();

  assert.equal(result.success, false);
  assert.equal(result.fallbackToSettings, true);
  assert.equal(result.reason, "app-bundle-unavailable");
});

test("permission flow IPC, preload, types, and permission hook are wired together", async () => {
  const [mainSource, preloadSource, typesSource, ipcSource, hookSource, onboardingSource, settingsSource] =
    await Promise.all([
      readRepoFile("main.js"),
      readRepoFile("preload.js"),
      readRepoFile("src/types/electron.ts"),
      readRepoFile("src/helpers/ipcHandlers.js"),
      readRepoFile("src/hooks/usePermissions.ts"),
      readRepoFile("src/components/OnboardingFlow.tsx"),
      readRepoFile("src/components/SettingsPage.tsx"),
    ]);

  assert.match(
    preloadSource,
    /startAccessibilityPermissionFlow:\s*\(options\)\s*=>\s*ipcRenderer\.invoke\("start-accessibility-permission-flow",\s*options\)/
  );
  assert.match(
    preloadSource,
    /onAccessibilityPermissionFlowEvent:\s*registerListener\("accessibility-permission-flow-event"/
  );
  assert.match(
    typesSource,
    /startAccessibilityPermissionFlow\?:\s*\(\s*options\?: AccessibilityPermissionFlowOptions\s*\)\s*=>/s
  );
  assert.match(typesSource, /onAccessibilityPermissionFlowEvent\?:/);
  assert.match(ipcSource, /ipcMain\.handle\("start-accessibility-permission-flow"/);
  assert.match(ipcSource, /accessibility-permission-flow-event/);
  assert.match(mainSource, /macOSPermissionFlowManager\.stop\(\)/);
  assert.match(hookSource, /startAccessibilityPermissionFlow/);
  assert.match(hookSource, /window\.electronAPI\?\.startAccessibilityPermissionFlow/);
  assert.match(hookSource, /window\.electronAPI\?\.stopAccessibilityPermissionFlow/);
  assert.match(onboardingSource, /onRequest=\{permissionsHook\.startAccessibilityPermissionFlow\}/);
  assert.match(settingsSource, /onRequest=\{permissionsHook\.startAccessibilityPermissionFlow\}/);
});

test("permission flow build artifact is compiled and packaged as a macOS native helper", async () => {
  const [packageSource, builderSource, buildScriptSource] = await Promise.all([
    readRepoFile("package.json"),
    readRepoFile("electron-builder.json"),
    readRepoFile("scripts/build-macos-permission-flow.js"),
  ]);

  assert.match(
    packageSource,
    /"compile:permission-flow": "node scripts\/build-macos-permission-flow\.js"/
  );
  assert.match(packageSource, /compile:permission-flow/);
  assert.match(builderSource, /resources\/bin\/macos-permission-flow/);
  assert.match(buildScriptSource, /macos-permission-flow\.swift/);
  assert.match(buildScriptSource, /macos-permission-flow/);
});
