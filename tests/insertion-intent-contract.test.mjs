import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleUrl = `${pathToFileURL(
  path.resolve(process.cwd(), "src/utils/insertionIntent.ts")
).href}?ts=${Date.now()}`;

async function importInsertionIntentModule() {
  return import(moduleUrl);
}

test("insertion contract defaults to clipboard-preserving insert semantics", async () => {
  const mod = await importInsertionIntentModule();

  const request = mod.buildInsertionRequest({
    targetApp: {
      appName: "Notes",
      processId: 41,
      platform: "darwin",
      source: "main-process",
      capturedAt: "2026-03-21T10:00:00.000Z",
    },
  });

  assert.equal(request.intent, "insert");
  assert.equal(request.replaceSelectionExpected, false);
  assert.equal(request.preserveClipboard, true);
  assert.equal(request.allowFallbackCopy, true);
  assert.equal(request.fromStreaming, false);
  assert.equal(request.targetApp?.appName, "Notes");
});

test("insertion contract normalizes explicit replace and append intents", async () => {
  const mod = await importInsertionIntentModule();

  const replaceRequest = mod.normalizeInsertionRequest({
    intent: "replace_selection",
    replaceSelectionExpected: true,
    preserveClipboard: false,
    allowFallbackCopy: false,
  });
  const appendRequest = mod.normalizeInsertionRequest({
    intent: "append_after_selection",
    fromStreaming: true,
  });

  assert.equal(replaceRequest.intent, "replace_selection");
  assert.equal(replaceRequest.replaceSelectionExpected, true);
  assert.equal(replaceRequest.preserveClipboard, false);
  assert.equal(replaceRequest.allowFallbackCopy, false);

  assert.equal(appendRequest.intent, "append_after_selection");
  assert.equal(appendRequest.fromStreaming, true);
  assert.equal(appendRequest.replaceSelectionExpected, false);
  assert.equal(appendRequest.preserveClipboard, true);
  assert.equal(appendRequest.allowFallbackCopy, true);
});
