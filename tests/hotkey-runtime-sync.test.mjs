import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("successful hotkey registration notifies the main process about runtime hotkey changes", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/hooks/useHotkeyRegistration.ts"),
    "utf8"
  );

  assert.match(source, /window\.electronAPI\?\.notifyHotkeyChanged\?\.\(hotkey\);/);
});

test("macOS hotkey change handler restarts the native globe listener", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "main.js"), "utf8");

  assert.match(
    source,
    /ipcMain\.on\("hotkey-changed",[\s\S]*globeAutoSession\.abort\(\);[\s\S]*rightModifierAutoSession\.abort\(\);[\s\S]*globeKeyManager\.stop\(\);[\s\S]*setTimeout\(\(\) => \{[\s\S]*globeKeyManager\?\.start\(\);/
  );
});
