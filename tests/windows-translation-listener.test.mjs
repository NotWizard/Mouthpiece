import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("WindowsKeyManager exposes startTranslation / stopTranslation for the dedicated translation-chord listener", async () => {
  const source = await readRepoFile("src/helpers/windowsKeyManager.js");

  assert.match(
    source,
    /startTranslation\s*\(\s*key\s*\)/,
    "expected WindowsKeyManager to define startTranslation(key)"
  );
  assert.match(
    source,
    /stopTranslation\s*\(\s*\)/,
    "expected WindowsKeyManager to define stopTranslation()"
  );
  assert.match(
    source,
    /_translationProcess/,
    "expected WindowsKeyManager to keep the translation listener child in a separate process slot from the push-to-talk listener"
  );
});

test("startTranslation emits 'translation-key-down' on KEY_DOWN and ignores KEY_UP (translation is tap-to-toggle)", async () => {
  const source = await readRepoFile("src/helpers/windowsKeyManager.js");
  const fnStart = source.indexOf("startTranslation");
  const fnSlice = source.slice(fnStart, fnStart + 4000);

  assert.match(
    fnSlice,
    /this\.emit\(["']translation-key-down["']/,
    "expected the translation listener to publish 'translation-key-down' to consumers"
  );
  assert.ok(
    !/this\.emit\(["']translation-key-up["']/.test(fnSlice),
    "translation chord is tap-to-toggle; emitting a 'translation-key-up' event would invite consumers to add keyUp logic and double-fire the toggle"
  );
});

test("applyTranslationHotkey on win32 spawns the native translation listener instead of registering via globalShortcut", async () => {
  const source = await readRepoFile("main.js");
  const fnStart = source.indexOf("function applyTranslationHotkey");
  const fnSlice = source.slice(fnStart, fnStart + 4000);

  assert.match(
    fnSlice,
    /process\.platform\s*===\s*["']win32["'][\s\S]*?windowsKeyManager[\s\S]*?\.startTranslation\(/,
    "expected the win32 branch to call windowsKeyManager.startTranslation(...)"
  );
  // The function should no longer fall back to globalShortcut.register for
  // the translation chord on any platform — that path was deleted because
  // both main hotkeys (modifier-only) and translation chords (prefix +
  // primary key) frequently contain tokens Electron can't accept (Globe,
  // Right*).
  assert.ok(
    !/globalShortcut\.register\(\s*trimmed/.test(fnSlice),
    "applyTranslationHotkey must not call globalShortcut.register(trimmed) anymore — the translation chord is owned by the native listeners now"
  );
});

test("main.js routes 'translation-key-down' through resetWindowsPushState before forwarding the toggle so a Control-held → K-pressed sequence doesn't double-fire", async () => {
  const source = await readRepoFile("main.js");
  const handlerStart = source.indexOf('windowsKeyManager.on("translation-key-down"');
  assert.notEqual(
    handlerStart,
    -1,
    "expected main.js to subscribe to 'translation-key-down' on windowsKeyManager"
  );
  const handlerSlice = source.slice(handlerStart, handlerStart + 800);

  const resetIdx = handlerSlice.indexOf("resetWindowsPushState");
  const sendIdx = handlerSlice.indexOf("sendToggleTranslationDictation");

  assert.notEqual(resetIdx, -1, "translation handler must call windowManager.resetWindowsPushState to abort the in-flight push-to-talk session");
  assert.notEqual(sendIdx, -1, "translation handler must forward sendToggleTranslationDictation to the renderer");
  assert.ok(
    resetIdx < sendIdx,
    "expected resetWindowsPushState to run before sendToggleTranslationDictation so the main session's onHoldStop/onPendingCancel fires first"
  );
});

test("applyTranslationHotkey tears down the existing translation listener on win32 before re-applying", async () => {
  const source = await readRepoFile("main.js");
  const fnStart = source.indexOf("function applyTranslationHotkey");
  const fnSlice = source.slice(fnStart, fnStart + 4000);

  assert.match(
    fnSlice,
    /if\s*\(\s*currentTranslationAccelerator\s*\)[\s\S]{0,400}?windowsKeyManager[\s\S]{0,80}?\.stopTranslation\(/,
    "expected the unregister block to call windowsKeyManager.stopTranslation on win32 so re-applying with a new key doesn't leak the previous child process"
  );
});
