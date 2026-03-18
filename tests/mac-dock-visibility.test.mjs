import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("macOS hide-window handler does not reshow the Dock when the dictation overlay closes", async () => {
  const source = await fs.readFile(path.resolve(process.cwd(), "src/helpers/ipcHandlers.js"), "utf8");

  assert.match(source, /ipcMain\.handle\("hide-window",\s*\(\)\s*=>\s*\{/);
  assert.doesNotMatch(
    source,
    /ipcMain\.handle\("hide-window",[\s\S]*app\.dock\.show\(\)[\s\S]*\}\s*\);/
  );
});
