import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { CONTROL_PANEL_CONFIG } = require("../src/helpers/windowConfig.js");

test("control panel allows Chromium to throttle rendering while hidden or backgrounded", () => {
  assert.notEqual(
    CONTROL_PANEL_CONFIG.webPreferences.backgroundThrottling,
    false,
    "Control Panel must not opt out of Chromium background throttling"
  );
});
