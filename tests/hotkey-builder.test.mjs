import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadHotkeyBuilderModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/hotkeyBuilder.js")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("macOS builder capabilities expose Fn and supported modifier-only choices", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.getHotkeyBuilderCapabilities, "function");

  const caps = mod.getHotkeyBuilderCapabilities({
    platform: "darwin",
  });

  assert.equal(caps.allowModifierOnlyMode, true);
  assert.deepEqual(caps.modifierOnlyOptions.map((option) => option.hotkey), [
    "GLOBE",
    "RightCommand",
    "RightOption",
    "RightControl",
    "RightShift",
  ]);
  assert.deepEqual(caps.comboModifierOptions.map((option) => option.hotkey), [
    "Command",
    "Control",
    "Alt",
    "Shift",
  ]);
});

test("windows builder keeps right-side modifier-only shortcuts exclusive", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.getHotkeyBuilderCapabilities, "function");

  const caps = mod.getHotkeyBuilderCapabilities({
    platform: "win32",
  });

  const rightAltOption = caps.modifierOnlyOptions.find((option) => option.hotkey === "RightAlt");
  const controlOption = caps.modifierOnlyOptions.find((option) => option.hotkey === "Control");

  assert.equal(rightAltOption?.exclusive, true);
  assert.equal(controlOption?.exclusive ?? false, false);
});

test("builder serializes modifier-only and key-combo shortcuts", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.buildHotkeyFromBuilderState, "function");
  assert.equal(mod.HOTKEY_BUILDER_MODES?.singleKey, "single-key");

  assert.equal(
    mod.buildHotkeyFromBuilderState({
      mode: "modifier-only",
      selectedModifiers: ["RightOption"],
      primaryKey: "",
    }),
    "RightOption"
  );

  assert.equal(
    mod.buildHotkeyFromBuilderState({
      mode: "key-combo",
      selectedModifiers: ["Alt"],
      primaryKey: "A",
    }),
    "Alt+A"
  );

  assert.equal(
    mod.buildHotkeyFromBuilderState({
      mode: "key-combo",
      selectedModifiers: [],
      primaryKey: "F8",
    }),
    ""
  );

  assert.equal(
    mod.buildHotkeyFromBuilderState({
      mode: "key-combo",
      selectedModifiers: ["Command", "Shift"],
      primaryKey: "M",
    }),
    "Command+Shift+M"
  );
});

test("builder parses persisted hotkeys back into editable builder state", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.parseHotkeyToBuilderState, "function");

  assert.deepEqual(
    mod.parseHotkeyToBuilderState({
      hotkey: "GLOBE",
      platform: "darwin",
      }),
    {
      mode: "modifier-only",
      selectedModifiers: ["GLOBE"],
      primaryKey: "",
    }
  );

  assert.deepEqual(
    mod.parseHotkeyToBuilderState({
      hotkey: "F8",
      platform: "win32",
      }),
    {
      mode: "single-key",
      selectedModifiers: [],
      primaryKey: "F8",
    }
  );

  assert.deepEqual(
    mod.parseHotkeyToBuilderState({
      hotkey: "Control+Shift+Space",
      platform: "win32",
      }),
    {
      mode: "key-combo",
      selectedModifiers: ["Control", "Shift"],
      primaryKey: "Space",
    }
  );
});

test("applyHotkeyBuilderLocks pins the mode and drops the primary key in modifier-only lock", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.applyHotkeyBuilderLocks, "function");

  const result = mod.applyHotkeyBuilderLocks(
    { mode: "key-combo", selectedModifiers: ["Command"], primaryKey: "K" },
    { lockedMode: "modifier-only" }
  );

  assert.equal(result.mode, "modifier-only");
  assert.equal(result.primaryKey, "");
});

test("applyHotkeyBuilderLocks merges locked modifiers without dropping the user's primary key", async () => {
  const mod = await loadHotkeyBuilderModule();

  const result = mod.applyHotkeyBuilderLocks(
    { mode: "key-combo", selectedModifiers: [], primaryKey: "K" },
    { lockedMode: "key-combo", lockedModifiers: ["GLOBE"] }
  );

  assert.equal(result.mode, "key-combo");
  assert.deepEqual(result.selectedModifiers, ["GLOBE"]);
  assert.equal(result.primaryKey, "K");
});

test("applyHotkeyBuilderLocks preserves already-locked modifiers without duplication", async () => {
  const mod = await loadHotkeyBuilderModule();

  const result = mod.applyHotkeyBuilderLocks(
    { mode: "key-combo", selectedModifiers: ["GLOBE"], primaryKey: "K" },
    { lockedMode: "key-combo", lockedModifiers: ["GLOBE"] }
  );

  assert.deepEqual(result.selectedModifiers, ["GLOBE"]);
});

test("applyHotkeyBuilderLocks tolerates missing or partial draft input", async () => {
  const mod = await loadHotkeyBuilderModule();

  const fromEmpty = mod.applyHotkeyBuilderLocks(
    {},
    { lockedMode: "modifier-only", lockedModifiers: ["RightCommand"] }
  );

  assert.equal(fromEmpty.mode, "modifier-only");
  assert.deepEqual(fromEmpty.selectedModifiers, ["RightCommand"]);
  assert.equal(fromEmpty.primaryKey, "");
});

test("buildHotkeyFromBuilderState produces a Globe-prefixed combo hotkey for translation lock", async () => {
  const mod = await loadHotkeyBuilderModule();

  // After applyHotkeyBuilderLocks pins GLOBE as the modifier prefix, the
  // builder must emit "GLOBE+<key>" so the translation hotkey can satisfy the
  // P9.1 prefix-match invariant against a Globe-only main hotkey.
  const result = mod.buildHotkeyFromBuilderState({
    mode: "key-combo",
    selectedModifiers: ["GLOBE"],
    primaryKey: "K",
    platform: "darwin",
  });

  assert.equal(result, "GLOBE+K");
});
