import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("dictation paste requests preserve the final transcription in the clipboard", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(
    source,
    /audioManagerRef\.current\.safePaste\(\s*result\.text,\s*isStreaming\s*\?\s*\{\s*fromStreaming:\s*true,\s*preserveClipboard:\s*true\s*\}\s*:\s*\{\s*preserveClipboard:\s*true\s*\}\s*\)/
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
