import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadInsertionPlanModule() {
  return require(path.resolve(process.cwd(), "src/helpers/insertionPlan.js"));
}

test("insertion plan keeps replace-selection flows monitorable and clipboard-fallback capable", () => {
  const mod = loadInsertionPlanModule();

  const plan = mod.createInsertionPlan({
    platform: "darwin",
    request: {
      intent: "replace_selection",
      replaceSelectionExpected: true,
      preserveClipboard: true,
      allowFallbackCopy: true,
    },
  });

  assert.equal(plan.expectedOutcomeMode, "replaced");
  assert.equal(plan.primaryAction.type, "auto_paste");
  assert.equal(plan.monitor.mode, "selection_sensitive");
  assert.equal(plan.fallbackAction.type, "clipboard_only");
});

test("insertion plan disables text monitoring for append-after-selection flows", () => {
  const mod = loadInsertionPlanModule();

  const plan = mod.createInsertionPlan({
    platform: "darwin",
    request: {
      intent: "append_after_selection",
      allowFallbackCopy: true,
    },
  });

  assert.equal(plan.expectedOutcomeMode, "appended");
  assert.equal(plan.monitor.mode, "disabled");
  assert.equal(plan.monitor.reason, "append_intent");
});

test("insertion plan degrades to clipboard-only when auto-paste is not viable", () => {
  const mod = loadInsertionPlanModule();

  const plan = mod.createInsertionPlan({
    platform: "win32",
    request: {
      intent: "insert",
      allowFallbackCopy: true,
    },
    capabilities: {
      autoPasteViable: false,
      autoPasteReason: "focus_not_editable",
    },
  });

  assert.equal(plan.primaryAction.type, "clipboard_only");
  assert.equal(plan.primaryAction.reason, "focus_not_editable");
  assert.equal(plan.expectedOutcomeMode, "copied");
  assert.equal(plan.monitor.mode, "disabled");
});
