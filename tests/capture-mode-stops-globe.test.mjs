import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

function extractSetHotkeyListeningModeBody(source) {
  const handlerStart = source.indexOf('"set-hotkey-listening-mode"');
  if (handlerStart === -1) return "";
  // Take a generous window after the handler start; the handler is not
  // exceptionally long so we just clip a fixed slice.
  return source.slice(handlerStart, handlerStart + 8000);
}

test("set-hotkey-listening-mode entering capture mode stops the macOS globe listener so Fn / RightCommand can be re-captured", async () => {
  const source = await readRepoFile("src/helpers/ipcHandlers.js");
  const handler = extractSetHotkeyListeningModeBody(source);
  // The bug: capture-mode entry handled globalShortcut.unregister and windowsKeyManager.stop,
  // but never stopped globeKeyManager. If currentHotkey was GLOBE or a right-side modifier,
  // the Swift listener kept firing dictation while the user tried to record a new key.
  assert.match(
    handler,
    /globeKeyManager[\s\S]{0,80}\.stop\(\)/,
    "set-hotkey-listening-mode entering capture mode must stop globeKeyManager when needed"
  );
});

test("set-hotkey-listening-mode exiting capture mode restarts the macOS globe listener via the same channel as hotkey-changed", async () => {
  const source = await readRepoFile("src/helpers/ipcHandlers.js");
  const handler = extractSetHotkeyListeningModeBody(source);
  assert.match(
    handler,
    /(globeKeyManager[\s\S]{0,80}\.start\(\)|hotkeyManager\.emit\(\s*["']hotkey-changed["'])/,
    "set-hotkey-listening-mode must restart the macOS globe listener when leaving capture mode (directly or via the hotkey-changed event)"
  );
});
