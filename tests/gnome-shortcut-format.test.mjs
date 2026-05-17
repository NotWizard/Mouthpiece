import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadModule() {
  return require(path.resolve(process.cwd(), "src/helpers/gnomeShortcut.js"));
}

test("convertToGnomeFormat treats RightControl as Control (GNOME ignores left/right modifier distinction)", () => {
  const GnomeShortcutManager = loadModule();
  const result = GnomeShortcutManager.convertToGnomeFormat("RightControl+K");
  assert.equal(result, "<Control>k", `expected '<Control>k' but got '${result}'`);
});

test("convertToGnomeFormat treats RightAlt as Alt", () => {
  const GnomeShortcutManager = loadModule();
  assert.equal(GnomeShortcutManager.convertToGnomeFormat("RightAlt+R"), "<Alt>r");
});

test("convertToGnomeFormat treats RightShift as Shift", () => {
  const GnomeShortcutManager = loadModule();
  // GNOME keysyms are case-sensitive but the existing function lowercases the
  // primary key — fixing F-key casing is a separate concern from RightX mapping.
  assert.match(
    GnomeShortcutManager.convertToGnomeFormat("RightShift+R"),
    /^<Shift>r$/
  );
});

test("convertToGnomeFormat treats RightSuper / RightMeta as Super", () => {
  const GnomeShortcutManager = loadModule();
  assert.equal(GnomeShortcutManager.convertToGnomeFormat("RightSuper+R"), "<Super>r");
  assert.equal(GnomeShortcutManager.convertToGnomeFormat("RightMeta+M"), "<Super>m");
});

test("convertToGnomeFormat returns empty string for modifier-only hotkeys (GNOME global shortcuts cannot bind modifier-only)", () => {
  const GnomeShortcutManager = loadModule();
  // GNOME's gsettings keybindings only fire on a key press combined with modifiers,
  // so a modifier-only hotkey would fail silently and bind something nonsensical.
  // Returning "" forces the hotkeyManager to fall back to X11 globalShortcut.
  for (const hotkey of ["RightCommand", "RightOption", "Control", "Alt", "Shift"]) {
    const result = GnomeShortcutManager.convertToGnomeFormat(hotkey);
    assert.equal(
      result,
      "",
      `modifier-only hotkey "${hotkey}" must convert to "" (got "${result}") so GNOME registration is skipped`
    );
  }
});

test("convertToGnomeFormat unaffected for already-canonical compound hotkeys", () => {
  const GnomeShortcutManager = loadModule();
  assert.equal(GnomeShortcutManager.convertToGnomeFormat("Control+K"), "<Control>k");
  assert.equal(GnomeShortcutManager.convertToGnomeFormat("Alt+R"), "<Alt>r");
});
