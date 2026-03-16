import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function loadOverlayStateModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/dictationOverlayState.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("dictation capsule only renders while recording", async () => {
  const mod = await loadOverlayStateModule();

  assert.equal(typeof mod.shouldShowDictationCapsule, "function");
  assert.equal(mod.shouldShowDictationCapsule({ isRecording: true }), true);
  assert.equal(mod.shouldShowDictationCapsule({ isRecording: false, isProcessing: true }), false);
  assert.equal(mod.shouldShowDictationCapsule({ isRecording: false, isProcessing: false }), false);
});

test("dictation window stays visible only for active recording, menu, or toasts", async () => {
  const mod = await loadOverlayStateModule();

  assert.equal(typeof mod.shouldKeepDictationWindowVisible, "function");
  assert.equal(
    mod.shouldKeepDictationWindowVisible({
      isRecording: true,
      isCommandMenuOpen: false,
      toastCount: 0,
    }),
    true
  );
  assert.equal(
    mod.shouldKeepDictationWindowVisible({
      isRecording: false,
      isCommandMenuOpen: true,
      toastCount: 0,
    }),
    true
  );
  assert.equal(
    mod.shouldKeepDictationWindowVisible({
      isRecording: false,
      isCommandMenuOpen: false,
      toastCount: 1,
    }),
    true
  );
  assert.equal(
    mod.shouldKeepDictationWindowVisible({
      isRecording: false,
      isCommandMenuOpen: false,
      toastCount: 0,
    }),
    false
  );
});

test("dictation overlay constants match the dock-aligned compact layout", async () => {
  const mod = await loadOverlayStateModule();

  assert.equal(mod.DICTATION_CAPSULE_BOTTOM_OFFSET_PX, 15);
  assert.equal(mod.DICTATION_CAPSULE_WIDTH_PX, 308);
});

test("main window defaults to a smaller centered capsule position above the dock", () => {
  const { WINDOW_SIZES, WindowPositionUtil } = require(
    path.resolve(process.cwd(), "src/helpers/windowConfig.js")
  );

  assert.deepEqual(WINDOW_SIZES.BASE, { width: 344, height: 132 });

  const display = {
    workArea: { x: 0, y: 23, width: 1440, height: 877 },
  };

  assert.deepEqual(WindowPositionUtil.getMainWindowPosition(display), {
    x: 548,
    y: 768,
    width: 344,
    height: 132,
  });
});
