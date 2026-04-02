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
    isUsingGnome: false,
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

test("GNOME builder capabilities disable modifier-only mode and keep combo modifiers", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.getHotkeyBuilderCapabilities, "function");

  const caps = mod.getHotkeyBuilderCapabilities({
    platform: "linux",
    isUsingGnome: true,
  });

  assert.equal(caps.allowModifierOnlyMode, false);
  assert.deepEqual(caps.modifierOnlyOptions, []);
  assert.deepEqual(caps.comboModifierOptions.map((option) => option.hotkey), [
    "Control",
    "Alt",
    "Shift",
    "Super",
  ]);
});

test("windows builder keeps right-side modifier-only shortcuts exclusive", async () => {
  const mod = await loadHotkeyBuilderModule();

  assert.equal(typeof mod.getHotkeyBuilderCapabilities, "function");

  const caps = mod.getHotkeyBuilderCapabilities({
    platform: "win32",
    isUsingGnome: false,
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
      isUsingGnome: false,
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
      isUsingGnome: false,
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
      isUsingGnome: false,
    }),
    {
      mode: "key-combo",
      selectedModifiers: ["Control", "Shift"],
      primaryKey: "Space",
    }
  );
});
