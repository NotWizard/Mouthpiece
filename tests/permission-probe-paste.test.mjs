import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadPasteUiStateModule() {
  const modulePath = path.resolve(process.cwd(), "src/helpers/pasteUiState.js");

  try {
    return require(modulePath);
  } catch {
    return {};
  }
}

test("permission probes do not restore the dictation panel after clipboard fallback", () => {
  const mod = loadPasteUiStateModule();

  assert.equal(typeof mod.shouldRestoreDictationPanelAfterPaste, "function");
  assert.equal(
    mod.shouldRestoreDictationPanelAfterPaste(
      { mode: "copied" },
      { suppressDictationPanelRestore: true }
    ),
    false
  );
  assert.equal(
    mod.shouldRestoreDictationPanelAfterPaste(
      { mode: "failed" },
      { suppressDictationPanelRestore: true }
    ),
    false
  );
});

test("normal paste fallbacks still restore the dictation panel", () => {
  const mod = loadPasteUiStateModule();

  assert.equal(typeof mod.shouldRestoreDictationPanelAfterPaste, "function");
  assert.equal(mod.shouldRestoreDictationPanelAfterPaste({ mode: "copied" }), true);
  assert.equal(mod.shouldRestoreDictationPanelAfterPaste({ mode: "failed" }), true);
  assert.equal(mod.shouldRestoreDictationPanelAfterPaste({ mode: "pasted" }), false);
});

test("accessibility permission probe suppresses dictation panel restore", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/hooks/usePermissions.ts"),
    "utf8"
  );

  assert.match(
    source,
    /pasteText\(\s*t\("hooks\.permissions\.accessibilityTestText"\)\s*,\s*\{[\s\S]*suppressDictationPanelRestore:\s*true[\s\S]*\}\s*\)/
  );
});

test("clipboard flow routes paste execution through the insertion planner", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/clipboard.js"),
    "utf8"
  );

  assert.match(source, /createInsertionPlan/);
  assert.match(source, /(const|let) insertionPlan = createInsertionPlan\(/);
});

test("paste IPC passes planner-derived monitor metadata into text monitoring", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/ipcHandlers.js"),
    "utf8"
  );

  assert.match(source, /monitorMode:\s*normalizedResult\.monitorMode/);
  assert.match(source, /intent:\s*normalizedOptions\.intent/);
});

test("save transcription IPC still returns the database result payload", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/ipcHandlers.js"),
    "utf8"
  );

  assert.match(
    source,
    /ipcMain\.handle\("db-save-transcription",[\s\S]*const result = this\.databaseManager\.saveTranscription\(text\);[\s\S]*return result;/
  );
});
