import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadAutomaticActivationModule() {
  return require(path.resolve(process.cwd(), "src/helpers/automaticActivation.js"));
}

function createFakeTimerController() {
  let nextId = 1;
  const pending = new Map();

  return {
    schedule(callback) {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    flushAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

function createVirtualTimerController() {
  let nextId = 1;
  let now = 0;
  const pending = new Map();

  return {
    schedule(callback, delay = 0) {
      const id = nextId++;
      pending.set(id, {
        callback,
        dueAt: now + delay,
      });
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    advanceTo(nextNow) {
      now = nextNow;
      const dueEntries = [...pending.entries()]
        .filter(([, entry]) => entry.dueAt <= now)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt);

      for (const [id, entry] of dueEntries) {
        if (!pending.has(id)) {
          continue;
        }
        pending.delete(id);
        entry.callback();
      }
    },
  };
}

test("automatic activation treats a quick release as tap mode", () => {
  const { AUTOMATIC_ACTIVATION_THRESHOLD_MS, createAutomaticActivationSession } =
    loadAutomaticActivationModule();
  const timers = createFakeTimerController();
  const events = [];

  const session = createAutomaticActivationSession({
    thresholdMs: AUTOMATIC_ACTIVATION_THRESHOLD_MS,
    schedule: (callback) => timers.schedule(callback),
    cancel: (id) => timers.cancel(id),
    onShow: () => events.push("show"),
    onTap: () => events.push("tap"),
    onHoldStart: () => events.push("hold-start"),
    onHoldStop: () => events.push("hold-stop"),
  });

  session.keyDown();
  const outcome = session.keyUp();

  assert.equal(outcome, "tap");
  assert.deepEqual(events, ["show", "tap"]);
  assert.deepEqual(session.getState(), {
    active: false,
    holdStarted: false,
  });
});

test("automatic activation keeps a deliberate single click in tap mode", () => {
  const { AUTOMATIC_ACTIVATION_THRESHOLD_MS, createAutomaticActivationSession } =
    loadAutomaticActivationModule();
  const timers = createVirtualTimerController();
  const events = [];

  const session = createAutomaticActivationSession({
    thresholdMs: AUTOMATIC_ACTIVATION_THRESHOLD_MS,
    schedule: (callback, delay) => timers.schedule(callback, delay),
    cancel: (id) => timers.cancel(id),
    onShow: () => events.push("show"),
    onTap: () => events.push("tap"),
    onHoldStart: () => events.push("hold-start"),
    onHoldStop: () => events.push("hold-stop"),
  });

  session.keyDown();
  timers.advanceTo(280);
  const outcome = session.keyUp();

  assert.equal(outcome, "tap");
  assert.deepEqual(events, ["show", "tap"]);
  assert.ok(
    AUTOMATIC_ACTIVATION_THRESHOLD_MS > 280,
    "automatic activation threshold should leave room for normal single-click duration"
  );
});

test("automatic activation enters hold mode after the threshold and stops on release", () => {
  const { AUTOMATIC_ACTIVATION_THRESHOLD_MS, createAutomaticActivationSession } =
    loadAutomaticActivationModule();
  const timers = createFakeTimerController();
  const events = [];

  const session = createAutomaticActivationSession({
    thresholdMs: AUTOMATIC_ACTIVATION_THRESHOLD_MS,
    schedule: (callback) => timers.schedule(callback),
    cancel: (id) => timers.cancel(id),
    onShow: () => events.push("show"),
    onTap: () => events.push("tap"),
    onHoldStart: () => events.push("hold-start"),
    onHoldStop: () => events.push("hold-stop"),
  });

  session.keyDown();
  timers.flushAll();
  const outcome = session.keyUp();

  assert.equal(outcome, "hold");
  assert.deepEqual(events, ["show", "hold-start", "hold-stop"]);
  assert.deepEqual(session.getState(), {
    active: false,
    holdStarted: false,
  });
});

test("automatic activation can be hard-cancelled without firing tap or hold-stop callbacks", () => {
  const { AUTOMATIC_ACTIVATION_THRESHOLD_MS, createAutomaticActivationSession } =
    loadAutomaticActivationModule();
  const timers = createFakeTimerController();
  const events = [];

  const session = createAutomaticActivationSession({
    thresholdMs: AUTOMATIC_ACTIVATION_THRESHOLD_MS,
    schedule: (callback) => timers.schedule(callback),
    cancel: (id) => timers.cancel(id),
    onShow: () => events.push("show"),
    onTap: () => events.push("tap"),
    onHoldStart: () => events.push("hold-start"),
    onHoldStop: () => events.push("hold-stop"),
  });

  session.keyDown();
  timers.flushAll();
  const outcome = session.cancel();

  assert.equal(outcome, "hold");
  assert.deepEqual(events, ["show", "hold-start"]);
  assert.deepEqual(session.getState(), {
    active: false,
    holdStarted: false,
  });
});

test("automatic activation falls back to tap when key release cannot be detected", () => {
  const { getAutomaticActivationSupport } = loadAutomaticActivationModule();

  assert.deepEqual(
    getAutomaticActivationSupport({
      platform: "linux",
      hotkey: "Alt+R",
      isUsingGnome: true,
    }),
    {
      supportsHold: false,
      mode: "tap-only",
      reason: "gnome-shortcut",
    }
  );

  assert.deepEqual(
    getAutomaticActivationSupport({
      platform: "darwin",
      hotkey: "Control+A",
      isUsingGnome: false,
    }),
    {
      supportsHold: false,
      mode: "tap-only",
      reason: "shortcut-without-key-up",
    }
  );

  assert.deepEqual(
    getAutomaticActivationSupport({
      platform: "darwin",
      hotkey: "GLOBE",
      isUsingGnome: false,
    }),
    {
      supportsHold: true,
      mode: "automatic",
      reason: "native-key-up",
    }
  );
});

test("settings and onboarding no longer expose manual activation or floating icon controls", async () => {
  const [settingsSource, onboardingSource] = await Promise.all([
    fs.readFile(path.resolve(process.cwd(), "src/components/SettingsPage.tsx"), "utf8"),
    fs.readFile(path.resolve(process.cwd(), "src/components/OnboardingFlow.tsx"), "utf8"),
  ]);

  assert.doesNotMatch(settingsSource, /ActivationModeSelector/);
  assert.doesNotMatch(settingsSource, /floatingIconAutoHide/);
  assert.match(settingsSource, /settingsPage\.general\.hotkey\.activationBehavior/);

  assert.doesNotMatch(onboardingSource, /ActivationModeSelector/);
  assert.match(onboardingSource, /onboarding\.activation\.modeDescription/);
});
