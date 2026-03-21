import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("dictation paste requests preserve the final transcription in the clipboard", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(source, /buildInsertionRequest/);
  assert.match(source, /window\.electronAPI\?\.getTargetAppInfo\?\.\(\)/);
  assert.match(
    source,
    /const insertionRequest = buildInsertionRequest\(\{[\s\S]*fromStreaming:\s*isStreaming,[\s\S]*preserveClipboard:\s*true,[\s\S]*allowFallbackCopy:\s*true,[\s\S]*targetApp,[\s\S]*\}\)/
  );
  assert.match(
    source,
    /audioManagerRef\.current\.safePaste\(\s*result\.text,\s*\{[\s\S]*\.\.\.insertionRequest,[\s\S]*sensitiveAppProtectionEnabled:[\s\S]*sensitiveAppBlockInsertion:[\s\S]*\}\s*\)/
  );
});

test("clipboard restore paths honor preserveClipboard across platforms", async () => {
  const source = await readRepoFile("src/helpers/clipboard.js");

  assert.match(
    source,
    /async pasteMacOS\(originalClipboard, options = \{\}\) \{[\s\S]*?const shouldRestoreClipboard = !options\?\.preserveClipboard;/
  );
  assert.match(
    source,
    /async pasteWithFastPaste\(fastPastePath, originalClipboard, options = \{\}\) \{[\s\S]*?const shouldRestoreClipboard = !options\?\.preserveClipboard;/
  );
  assert.match(
    source,
    /async pasteLinux\(originalClipboard, options = \{\}\) \{[\s\S]*?const shouldRestoreClipboard = !options\?\.preserveClipboard;/
  );
  assert.match(
    source,
    /if \(shouldRestoreClipboard\) \{[\s\S]*?clipboard\.writeText\(originalClipboard\);[\s\S]*?this\.safeLog\("🔄 Clipboard restored"\);[\s\S]*?\}/
  );
});
