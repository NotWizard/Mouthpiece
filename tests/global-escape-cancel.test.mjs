import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("preload exposes global dictation cancel controls", async () => {
  const source = await readRepoFile("preload.js");

  assert.match(
    source,
    /setDictationCancelEnabled:\s*\(enabled\)\s*=>\s*ipcRenderer\.invoke\("set-dictation-cancel-enabled",\s*enabled\)/
  );
  assert.match(
    source,
    /onCancelDictation:\s*registerListener\(\s*"cancel-dictation",\s*\(callback\)\s*=>\s*\(_event,\s*data\)\s*=>\s*callback\(data\)\s*\)/s
  );
});

test("audio recording hook syncs active dictation state and listens for global cancel events", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(source, /const isDictationActive = isRecording \|\| isProcessing \|\| isTranscribing;/);
  assert.match(source, /window\.electronAPI\?\.setDictationCancelEnabled\?\.\(isDictationActive\)/);
  assert.match(source, /const disposeCancel = window\.electronAPI\.onCancelDictation\?\.\(\(\) => \{/);
  assert.match(
    source,
    /if \(\s*currentState\.isRecording\s*\|\|\s*currentState\.isStreaming\s*\|\|\s*currentState\.isStreamingStartInProgress\s*\)\s*\{\s*(?:void\s+)?cancelRecording\(\);\s*return;\s*\}/s
  );
  assert.match(source, /if \(currentState\.isProcessing\)\s*\{\s*cancelProcessing\(\);\s*\}/s);
});

test("main process registers a temporary global Escape shortcut that dispatches cancel-dictation", async () => {
  const [ipcHandlersSource, windowManagerSource] = await Promise.all([
    readRepoFile("src/helpers/ipcHandlers.js"),
    readRepoFile("src/helpers/windowManager.js"),
  ]);

  assert.match(
    ipcHandlersSource,
    /ipcMain\.handle\("set-dictation-cancel-enabled",\s*\(event,\s*enabled\)\s*=>\s*\{\s*this\.windowManager\.setDictationCancelEnabled\(Boolean\(enabled\)\);/
  );
  assert.match(
    windowManagerSource,
    /globalShortcut\.register\("Escape",\s*\(\)\s*=>\s*this\.requestDictationCancel\("escape"\)\s*\)/s
  );
  assert.match(windowManagerSource, /globalShortcut\.unregister\("Escape"\)/);
  assert.match(windowManagerSource, /this\.mainWindow\.webContents\.send\("cancel-dictation",\s*\{\s*source\s*\}\)/);
});
