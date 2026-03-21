import test from "node:test";
import assert from "node:assert/strict";

const toastPresentationModule = import("../src/utils/toastPresentation.mjs");

test("sticky reminder toasts expose the close affordance immediately", async () => {
  const { isToastCloseButtonAlwaysVisible } = await toastPresentationModule;

  assert.equal(isToastCloseButtonAlwaysVisible({ variant: "default", duration: 0 }), true);
  assert.equal(isToastCloseButtonAlwaysVisible({ variant: "success", duration: 0 }), true);
});

test("transient default toasts can keep the hover-only close affordance", async () => {
  const { isToastCloseButtonAlwaysVisible } = await toastPresentationModule;

  assert.equal(isToastCloseButtonAlwaysVisible({ variant: "default", duration: 3500 }), false);
});

test("destructive toasts always expose the close affordance", async () => {
  const { isToastCloseButtonAlwaysVisible } = await toastPresentationModule;

  assert.equal(
    isToastCloseButtonAlwaysVisible({ variant: "destructive", duration: 8000 }),
    true
  );
});

test("overlay toast presenter reveals the dictation panel before showing the toast", async () => {
  const { presentOverlayToast } = await toastPresentationModule;
  const events = [];

  const id = presentOverlayToast({
    showDictationPanel: () => {
      events.push("show");
    },
    toast: (options) => {
      events.push(["toast", options]);
      return "toast-1";
    },
    options: { title: "Clipboard copied", duration: 0 },
  });

  assert.equal(id, "toast-1");
  assert.deepEqual(events, ["show", ["toast", { title: "Clipboard copied", duration: 0 }]]);
});
