import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadMacOSAccessibilityModeModule() {
  try {
    return require(path.resolve(process.cwd(), "src/helpers/macOSAccessibilityMode.js"));
  } catch {
    return {};
  }
}

test("packaged macOS defaults to AppleScript helpers while development keeps native helpers", () => {
  const mod = loadMacOSAccessibilityModeModule();

  assert.equal(typeof mod.resolveMacOSAccessibilityMode, "function");

  const packaged = mod.resolveMacOSAccessibilityMode({
    platform: "darwin",
    isPackaged: true,
    env: {},
  });
  assert.equal(packaged.useNativePasteHelper, false);
  assert.equal(packaged.useNativeTextMonitor, false);
  assert.equal(packaged.reason, "packaged-default-apple-script");

  const development = mod.resolveMacOSAccessibilityMode({
    platform: "darwin",
    isPackaged: false,
    env: {},
  });
  assert.equal(development.useNativePasteHelper, true);
  assert.equal(development.useNativeTextMonitor, true);
  assert.equal(development.reason, "development-default-native");
});

test("macOS native helper mode can be forced back on with an explicit env override", () => {
  const mod = loadMacOSAccessibilityModeModule();

  assert.equal(typeof mod.resolveMacOSAccessibilityMode, "function");

  const forcedNative = mod.resolveMacOSAccessibilityMode({
    platform: "darwin",
    isPackaged: true,
    env: { MOUTHPIECE_MACOS_NATIVE_AX_HELPERS: "1" },
  });

  assert.equal(forcedNative.useNativePasteHelper, true);
  assert.equal(forcedNative.useNativeTextMonitor, true);
  assert.equal(forcedNative.reason, "env-forced-native");
});

test("clipboard and text monitor both route through the shared macOS helper policy and polling fallback", async () => {
  const [clipboardSource, monitorSource] = await Promise.all([
    fs.readFile(path.resolve(process.cwd(), "src/helpers/clipboard.js"), "utf8"),
    fs.readFile(path.resolve(process.cwd(), "src/helpers/textEditMonitor.js"), "utf8"),
  ]);

  assert.match(clipboardSource, /resolveMacOSAccessibilityMode/);
  assert.match(clipboardSource, /useNativePasteHelper/);
  assert.match(monitorSource, /resolveMacOSAccessibilityMode/);
  assert.match(monitorSource, /_fallbackMacOSNativeToPolling/);
  assert.match(monitorSource, /NO_ELEMENT/);
  assert.match(monitorSource, /NO_VALUE/);
});
