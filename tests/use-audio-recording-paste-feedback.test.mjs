import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("audio recording timeline keeps compatibility fallback metadata from paste results", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(source, /compatibilityProfileId:\s*pasteResult\?\.compatibilityProfileId/);
  assert.match(source, /feedbackCode:\s*pasteResult\?\.feedbackCode/);
  assert.match(source, /recoveryHint:\s*pasteResult\?\.recoveryHint/);
  assert.match(source, /retryCount:\s*pasteResult\?\.retryCount/);
});

test("paste IPC normalizes compatibility metadata for downstream monitoring and telemetry", async () => {
  const source = await readRepoFile("src/helpers/ipcHandlers.js");

  assert.match(source, /compatibilityProfileId:\s*result\?\.compatibilityProfileId\s*\|\|\s*"generic"/);
  assert.match(source, /feedbackCode:\s*result\?\.feedbackCode\s*\|\|\s*null/);
  assert.match(source, /retryCount:\s*Number\.isInteger\(result\?\.retryCount\)\s*\?\s*result\.retryCount\s*:\s*0/);
});
