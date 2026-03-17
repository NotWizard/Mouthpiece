import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("settings context is stored as a global singleton so HMR does not split provider and consumer", async () => {
  const source = await readRepoFile("src/hooks/useSettings.ts");

  assert.match(source, /declare global/);
  assert.match(source, /__mouthpieceSettingsContext/);
  assert.match(
    source,
    /const SettingsContext =\s*globalThis\.__mouthpieceSettingsContext \?\? createContext<SettingsValue \| null>\(null\);/
  );
  assert.match(
    source,
    /if \(!globalThis\.__mouthpieceSettingsContext\) \{\s*globalThis\.__mouthpieceSettingsContext = SettingsContext;\s*\}/
  );
});
