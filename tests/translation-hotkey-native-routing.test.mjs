import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("applyTranslationHotkey early-returns on darwin with the chord stored for the native key listener", async () => {
  const source = await readRepoFile("main.js");
  const applyStart = source.indexOf("function applyTranslationHotkey");
  assert.notEqual(applyStart, -1, "expected applyTranslationHotkey to still exist in main.js");
  const applyBody = source.slice(applyStart, applyStart + 4000);

  assert.match(
    applyBody,
    /process\.platform\s*===\s*["']darwin["'][\s\S]*?currentTranslationAccelerator\s*=\s*trimmed[\s\S]*?return\s*\{/,
    "expected the darwin branch to store the accelerator and return so the native Swift listener owns keyDown detection"
  );
  assert.match(
    applyBody,
    /transport:\s*["']native-key-listener["']/,
    "expected the darwin (and win32) return value to advertise the native-key-listener transport so the renderer can surface the right diagnostics later"
  );
});

test("globeKeyManager 'key-down-with-mods' handler matches the stored translation accelerator and aborts pending main-hotkey sessions before forwarding the toggle", async () => {
  const source = await readRepoFile("main.js");
  const handlerStart = source.indexOf('globeKeyManager.on("key-down-with-mods"');
  assert.notEqual(handlerStart, -1, "expected main.js to subscribe to 'key-down-with-mods' on globeKeyManager");
  const handlerBody = source.slice(handlerStart, handlerStart + 1200);

  assert.match(
    handlerBody,
    /currentTranslationAccelerator/,
    "translation chord handler must compare against currentTranslationAccelerator to avoid firing on arbitrary keyDown chords"
  );
  assert.match(
    handlerBody,
    /globeAutoSession\.abort\(\)/,
    "translation chord handler must abort globeAutoSession so a long Globe hold doesn't also fire the push-to-talk path"
  );
  assert.match(
    handlerBody,
    /rightModifierAutoSession\.abort\(\)/,
    "translation chord handler must also abort rightModifierAutoSession so a Right-Cmd-prefix translation chord doesn't double-fire the push-to-talk path"
  );
  assert.match(
    handlerBody,
    /sendToggleTranslationDictation/,
    "translation chord handler must forward sendToggleTranslationDictation to the renderer"
  );
});

test("applyTranslationHotkey no longer touches globalShortcut at all — both platforms route through their native listener", async () => {
  const source = await readRepoFile("main.js");
  const applyStart = source.indexOf("function applyTranslationHotkey");
  const applyBody = source.slice(applyStart, applyStart + 4000);

  // P9.6 deleted the globalShortcut.register / unregister path because the
  // main hotkey (modifier-only) and the translation chord (modifier prefix +
  // primary key) both frequently use tokens Electron's accelerator parser
  // can't accept (Globe, Right*). Keeping the old branch around would just
  // be a dead code path that fails silently.
  assert.ok(
    !/globalShortcut\.register\b/.test(applyBody),
    "applyTranslationHotkey must not call globalShortcut.register anymore — the translation chord is owned by the native listeners"
  );
  assert.ok(
    !/globalShortcut\.unregister\b/.test(applyBody),
    "applyTranslationHotkey must not call globalShortcut.unregister anymore — the previous accelerator was never registered with globalShortcut, so unregistering would be a no-op at best and a misleading log line at worst"
  );
});

