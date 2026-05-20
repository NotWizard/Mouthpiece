import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readWindowManagerSource() {
  return fs.readFile(path.resolve(process.cwd(), "src/helpers/windowManager.js"), "utf8");
}

function getMethodBody(source, methodName) {
  const start = source.indexOf(`  ${methodName}(`);
  assert.notEqual(start, -1, `${methodName} should exist`);

  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `${methodName} should have a method signature`);

  const bodyStart = source.indexOf("{", signatureEnd);
  assert.notEqual(bodyStart, -1, `${methodName} should have a body`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return source.slice(bodyStart + 1, index);
    }
  }

  assert.fail(`${methodName} body should close`);
}

test("dictation panel refreshes macOS Space and z-order state every time it is shown", async () => {
  const source = await readWindowManagerSource();
  const showBody = getMethodBody(source, "showDictationPanel");
  const refreshIndex = showBody.indexOf("this.refreshMainWindowForCurrentSpace()");
  const visibilityIndex = showBody.indexOf("this.mainWindow.isVisible()");

  assert.notEqual(refreshIndex, -1, "showDictationPanel should refresh Space state");
  assert.notEqual(visibilityIndex, -1, "showDictationPanel should still check visibility");
  assert.ok(
    refreshIndex < visibilityIndex,
    "Space state must refresh before visibility checks because macOS can report a panel visible on another Space"
  );
});

test("main window Space refresh keeps the panel above the current macOS desktop without stealing focus", async () => {
  const source = await readWindowManagerSource();
  const refreshBody = getMethodBody(source, "refreshMainWindowForCurrentSpace");

  assert.match(refreshBody, /this\.enforceMainWindowOnTop\(\)/);
  assert.match(refreshBody, /process\.platform === "darwin"/);
  assert.match(refreshBody, /moveTop/);
  assert.doesNotMatch(refreshBody, /\.focus\(/);
});
