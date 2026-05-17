import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("main.js declares a startupReadyPromise that resolves at the end of startApp", async () => {
  const source = await readRepoFile("main.js");
  assert.match(
    source,
    /startupReadyPromise/,
    "main.js must declare startupReadyPromise so deferred handlers can await full startup"
  );
  // Resolution at end of startApp (or equivalent) — either explicit resolve call
  // or an exposed resolver.
  assert.match(
    source,
    /(resolveStartupReady\(\)|startupReadyResolve\(\))/,
    "main.js must resolve the startupReadyPromise once startApp finishes"
  );
});

test("second-instance handler awaits startupReadyPromise so OAuth deep links are not dropped during the first 300ms", async () => {
  const source = await readRepoFile("main.js");
  // The handler block must reference startupReadyPromise.
  assert.match(
    source,
    /app\.on\("second-instance"[\s\S]{0,1500}startupReadyPromise/,
    "second-instance handler must await startupReadyPromise before using windowManager"
  );
});

test("open-url deep links are queued when windowManager is not yet ready", async () => {
  const source = await readRepoFile("main.js");
  assert.match(
    source,
    /pendingOAuthDeepLinks|pendingDeepLinks/,
    "main.js must queue OAuth deep links arriving before the control panel exists"
  );
});

test("HotkeyManager emits a hotkey-ready event after the saved hotkey resolves", async () => {
  const source = await readRepoFile("src/helpers/hotkeyManager.js");
  assert.match(
    source,
    /this\.emit\(\s*["']hotkey-ready["']/,
    "HotkeyManager must emit 'hotkey-ready' once startup hotkey resolution completes so native listeners can wait"
  );
});

test("HotkeyManager startup catch path still registers a fallback (env / default) hotkey instead of leaving the session unbound", async () => {
  const source = await readRepoFile("src/helpers/hotkeyManager.js");
  // Pull just the loadSavedHotkeyOrDefault method body and assert its catch
  // arm references _registerStartupHotkey so users keep SOME hotkey when
  // localStorage / env reads explode.
  const fnStart = source.indexOf("async loadSavedHotkeyOrDefault");
  assert.ok(fnStart !== -1, "loadSavedHotkeyOrDefault method must exist");
  // Generous slice — cover the entire method.
  const fnBody = source.slice(fnStart, fnStart + 6000);
  const catchIdx = fnBody.search(/}\s*catch\s*\(/);
  assert.ok(catchIdx !== -1, "loadSavedHotkeyOrDefault must have a catch arm");
  const catchBlock = fnBody.slice(catchIdx, catchIdx + 1500);
  assert.match(
    catchBlock,
    /_registerStartupHotkey|_signalHotkeyReady/,
    "loadSavedHotkeyOrDefault catch block must attempt a fallback registration so the session always has SOME hotkey"
  );
});

test("globeKeyManager.start() in main.js is gated on hotkey-ready, not fired immediately", async () => {
  const source = await readRepoFile("main.js");
  // Either there is no bare globeKeyManager.start() in the macOS startup block,
  // OR the start() call is wrapped inside a hotkeyManager.once("hotkey-ready", ...) handler.
  assert.match(
    source,
    /hotkeyManager\.(once|on)\(\s*["']hotkey-ready["'][\s\S]{0,200}globeKeyManager(\?\.|\.)start\(\)/,
    "main.js must wait for hotkey-ready before starting the macOS Globe listener so it doesn't observe the initial default hotkey window"
  );
});

test("Windows native listener startup uses the hotkey-ready event instead of a 3-second hardcoded timeout", async () => {
  const source = await readRepoFile("main.js");
  assert.doesNotMatch(
    source,
    /STARTUP_DELAY_MS\s*=\s*3000/,
    "main.js should not hardcode a 3000ms startup delay for the Windows key listener"
  );
  assert.match(
    source,
    /hotkeyManager\.(once|on)\(\s*["']hotkey-ready["'][\s\S]{0,200}restartWindowsKeyListener/,
    "main.js must restart the Windows key listener on hotkey-ready, not on a wall-clock timer"
  );
});

test("ipcMain.on(hotkey-changed) is registered before startApp completes (in initializeCoreManagers)", async () => {
  const source = await readRepoFile("main.js");
  // We allow the listener to live anywhere as long as it is attached on the
  // hotkeyManager event emitter (which fires reliably regardless of when the
  // renderer first sends notifyHotkeyChanged). The strictest check: the file
  // must contain hotkeyManager.on("hotkey-changed", ...) at least once.
  assert.match(
    source,
    /hotkeyManager\.on\(\s*["']hotkey-changed["']/,
    "main.js must subscribe hotkeyManager 'hotkey-changed' so listener restarts work as soon as hotkeyManager exists, not only after the renderer fires the legacy IPC"
  );
});
