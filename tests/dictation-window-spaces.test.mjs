import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WindowPositionUtil } = require("../src/helpers/windowConfig.js");

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

test("dictation panel moves to the display under the cursor and preserves its current size", () => {
  const bounds = { x: 788, y: 884, width: 344, height: 132 };
  const currentDisplay = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const targetDisplay = {
    id: 2,
    workArea: { x: -1512, y: 0, width: 1512, height: 950 },
  };
  const positions = [];
  const window = {
    getBounds: () => bounds,
    setPosition: (x, y) => positions.push([x, y]),
  };
  const screen = {
    getCursorScreenPoint: () => ({ x: -700, y: 400 }),
    getDisplayMatching: () => currentDisplay,
    getDisplayNearestPoint: () => targetDisplay,
  };

  const result = WindowPositionUtil.moveMainWindowToCursorDisplay(window, screen);

  assert.deepEqual(positions, [[-928, 818]]);
  assert.deepEqual(result, {
    moved: true,
    cursorPoint: { x: -700, y: 400 },
    currentDisplayId: 1,
    targetDisplayId: 2,
    beforeBounds: bounds,
    afterBounds: { x: -928, y: 818, width: 344, height: 132 },
  });
});

test("dictation panel keeps its dragged position when the cursor remains on the same display", () => {
  const bounds = { x: 220, y: 640, width: 344, height: 132 };
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  let setPositionCalled = false;
  const window = {
    getBounds: () => bounds,
    setPosition: () => {
      setPositionCalled = true;
    },
  };
  const screen = {
    getCursorScreenPoint: () => ({ x: 900, y: 400 }),
    getDisplayMatching: () => display,
    getDisplayNearestPoint: () => display,
  };

  const result = WindowPositionUtil.moveMainWindowToCursorDisplay(window, screen);

  assert.equal(setPositionCalled, false);
  assert.equal(result.moved, false);
  assert.deepEqual(result.afterBounds, bounds);
});

test("dictation panel resolves its active display before showing and logs the presentation state", async () => {
  const source = await readWindowManagerSource();
  const showBody = getMethodBody(source, "showDictationPanel");
  const placementIndex = showBody.indexOf("moveMainWindowToCursorDisplay");
  const showIndex = showBody.indexOf("showInactive");

  assert.notEqual(placementIndex, -1, "showDictationPanel should resolve cursor display placement");
  assert.notEqual(showIndex, -1, "showDictationPanel should show without stealing focus");
  assert.ok(placementIndex < showIndex, "the panel must move before it is shown");
  assert.match(showBody, /Dictation panel presentation/);
});
