import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

// The Swift listener gained a keyDown path so the renderer can route a
// translation hotkey (which is "<main modifiers> + <regular key>") without
// going through Electron's globalShortcut. These tests guard the contract
// between the native binary and globeKeyManager.js so a future refactor on
// either side can't silently drop it.

test("macos-globe-listener.swift includes .keyDown in its eventsOfInterest mask", async () => {
  const source = await readRepoFile("resources/macos-globe-listener.swift");
  assert.match(
    source,
    /1\s*<<\s*CGEventType\.keyDown\.rawValue/,
    "expected the swift event tap mask to include keyDown so translation-hotkey combos can be observed"
  );
});

test("macos-globe-listener.swift emits KEY_DOWN_WITH_MODS:<chord> on keyDown", async () => {
  const source = await readRepoFile("resources/macos-globe-listener.swift");
  assert.match(
    source,
    /emit\("KEY_DOWN_WITH_MODS:\\\(hotkey\)"\)/,
    "expected the swift listener to publish the keyDown chord as KEY_DOWN_WITH_MODS:<chord>"
  );
});

test("macos-globe-listener.swift tracks both left and right modifiers so the emitted chord can carry the right-side prefix from the main hotkey", async () => {
  const source = await readRepoFile("resources/macos-globe-listener.swift");
  assert.match(
    source,
    /leftModifiers:\s*\[\(Int64,\s*CGEventFlags,\s*String\)\]/,
    "expected a leftModifiers table so a Cmd+K chord can be distinguished from a RightCommand+K chord"
  );
  assert.match(
    source,
    /rightModifiers:\s*\[\(Int64,\s*CGEventFlags,\s*String\)\]/,
    "rightModifiers table must remain so right-side modifier-only hotkeys keep working"
  );
});

test("globeKeyManager.js forwards KEY_DOWN_WITH_MODS lines as 'key-down-with-mods' events", async () => {
  const source = await readRepoFile("src/helpers/globeKeyManager.js");
  assert.match(
    source,
    /KEY_DOWN_WITH_MODS:/,
    "expected globeKeyManager.js to recognise the KEY_DOWN_WITH_MODS prefix on the listener's stdout"
  );
  assert.match(
    source,
    /this\.emit\(["']key-down-with-mods["']/,
    "expected globeKeyManager.js to emit a 'key-down-with-mods' event so main.js can route the chord"
  );
});
