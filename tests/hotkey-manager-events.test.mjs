import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("HotkeyManager extends EventEmitter so listener restarts decouple from renderer notifyHotkeyChanged calls", async () => {
  const source = await readRepoFile("src/helpers/hotkeyManager.js");
  assert.match(
    source,
    /require\(["']events["']\)|EventEmitter/,
    "hotkeyManager.js must import / extend EventEmitter to broadcast hotkey changes"
  );
  assert.match(
    source,
    /class\s+HotkeyManager\s+extends\s+EventEmitter/,
    "HotkeyManager class must extend EventEmitter"
  );
});

test("HotkeyManager emits hotkey-changed after a successful update so callers don't have to remember to fire it themselves", async () => {
  const source = await readRepoFile("src/helpers/hotkeyManager.js");
  assert.match(
    source,
    /this\.emit\(\s*["']hotkey-changed["']/,
    "HotkeyManager must emit 'hotkey-changed' so main.js can restart native listeners regardless of whether the renderer also calls notifyHotkeyChanged"
  );
});

test("main.js subscribes hotkeyManager to the same restart logic as the IPC hotkey-changed event", async () => {
  const source = await readRepoFile("main.js");
  assert.match(
    source,
    /hotkeyManager\.on\(\s*["']hotkey-changed["']/,
    "main.js must register a hotkeyManager.on('hotkey-changed', ...) handler that mirrors the IPC restart so update-hotkey alone is enough"
  );
});
