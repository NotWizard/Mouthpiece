import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

test("saveTranscription accepts optional rawText and persists it", () => {
  const dbSource = read("src/helpers/database.js");
  assert.match(
    dbSource,
    /saveTranscription\(text,\s*rawText\)/,
    "database.js saveTranscription must accept rawText parameter"
  );
  assert.match(
    dbSource,
    /INSERT INTO transcriptions \(text,\s*raw_text\)/,
    "INSERT must include raw_text column"
  );
});

test("IPC db-save-transcription forwards rawText", () => {
  const source = read("src/helpers/ipcHandlers.js");
  assert.match(
    source,
    /ipcMain\.handle\("db-save-transcription",\s*async\s*\(event,\s*text,\s*rawText\)/
  );
  assert.match(source, /this\.databaseManager\.saveTranscription\(text,\s*rawText\)/);
});

test("preload exposes saveTranscription with rawText", () => {
  const source = read("preload.js");
  assert.match(
    source,
    /saveTranscription:\s*\(text,\s*rawText\)\s*=>\s*ipcRenderer\.invoke\("db-save-transcription",\s*text,\s*rawText\)/
  );
});

test("TranscriptionItem type and saveTranscription signature include raw_text / rawText", () => {
  const source = read("src/types/electron.ts");
  assert.match(source, /raw_text\?:\s*string\s*\|\s*null/);
  assert.match(
    source,
    /saveTranscription:\s*\(text:\s*string,\s*rawText\?:\s*string\s*\|\s*null\)\s*=>\s*Promise<\{\s*id:\s*number;\s*success:\s*boolean\s*\}>/
  );
});
