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

  // The handler may be defined inline in the IPC subscription or factored into a
  // named function; either way it must abort both auto-sessions and bounce the
  // native globe listener so the renamed/captured hotkey takes effect.
  assert.match(
    source,
    /globeAutoSession\.abort\(\);[\s\S]{0,300}rightModifierAutoSession\.abort\(\);[\s\S]{0,400}globeKeyManager\.stop\(\);[\s\S]{0,200}setTimeout\([\s\S]{0,200}globeKeyManager\?\.start\(\);/,
    "macOS hotkey change handler must reset both auto-sessions and restart the native globe listener"
  );
  // And the handler must be wired into the IPC channel.
  assert.match(
    source,
    /ipcMain\.on\(\s*["']hotkey-changed["']/,
    "ipcMain.on('hotkey-changed', ...) must remain registered"
  );
});
