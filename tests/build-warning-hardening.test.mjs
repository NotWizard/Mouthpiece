import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("settings store invalidates reasoning caches without dynamically importing ReasoningService", async () => {
  const [settingsSource, reasoningSource] = await Promise.all([
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/services/ReasoningService.ts"),
  ]);

  assert.doesNotMatch(settingsSource, /import\("\.\.\/services\/ReasoningService"\)/);
  assert.match(settingsSource, /window\.dispatchEvent\(new Event\("api-key-changed"\)\)/);
  assert.match(reasoningSource, /window\.addEventListener\("api-key-changed"/);
  assert.match(reasoningSource, /this\.clearApiKeyCache\(\)/);
});

test("vite config uses explicit vendor chunk resolution to keep renderer bundles under control", async () => {
  const source = await readRepoFile("src/vite.config.mjs");

  assert.match(source, /const resolveVendorChunk = \(id\) =>/);
  assert.match(source, /const resolveAppChunk = \(id\) =>/);
  assert.match(source, /manualChunks:\s*\(id\)\s*=>\s*\{/);
  assert.match(source, /const vendorChunk = resolveVendorChunk\(id\)/);
  assert.match(source, /const appChunk = resolveAppChunk\(id\)/);
  assert.match(source, /chunkSizeWarningLimit:\s*700/);
  assert.match(source, /app-dictation/);
  assert.match(source, /vendor-react/);
  assert.match(source, /vendor-i18n/);
  assert.match(source, /vendor-zod/);
  assert.match(source, /node_modules/);
});
