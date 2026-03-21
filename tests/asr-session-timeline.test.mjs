import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const modulePath = path.resolve(process.cwd(), "src/utils/asrSessionTimeline.mjs");
const flagsModulePath = path.resolve(process.cwd(), "src/utils/asrFeatureFlags.mjs");

test("ASR session timeline records normalized events and computes core latency metrics", async () => {
  const mod = await import(modulePath);

  const timeline = mod.createAsrSessionTimeline({
    sessionId: "asr_session_test",
    mode: "streaming",
    provider: "deepgram",
    startedAtMs: 100,
    startedAtIso: "2026-03-21T08:00:00.000Z",
  });

  mod.markAsrSessionEvent(timeline, "capture_ready", { inputDevice: "Built-in Mic" }, 130);
  mod.markAsrSessionEvent(timeline, "speech_detected", { rms: 0.031 }, 180);
  mod.markAsrSessionEvent(timeline, "first_partial", { textLength: 4 }, 220);
  mod.markAsrSessionEvent(timeline, "first_stable_partial", { textLength: 6 }, 320);
  mod.markAsrSessionEvent(timeline, "final_ready", { textLength: 12 }, 640);
  mod.markAsrSessionEvent(timeline, "paste_started", { textLength: 12 }, 700);
  mod.markAsrSessionEvent(timeline, "paste_finished", { mode: "pasted", success: true }, 760);
  mod.markAsrSessionEvent(timeline, "inserted", { mode: "pasted" }, 765);

  const summary = mod.finalizeAsrSessionTimeline(timeline, {
    status: "inserted",
    completedAtMs: 765,
  });

  assert.equal(summary.sessionId, "asr_session_test");
  assert.equal(summary.status, "inserted");
  assert.equal(summary.lastEventType, "inserted");
  assert.equal(summary.metrics.captureReadyLatencyMs, 30);
  assert.equal(summary.metrics.speechDetectedLatencyMs, 80);
  assert.equal(summary.metrics.firstPartialLatencyMs, 120);
  assert.equal(summary.metrics.firstStablePartialLatencyMs, 220);
  assert.equal(summary.metrics.finalReadyLatencyMs, 540);
  assert.equal(summary.metrics.pasteStartedLatencyMs, 600);
  assert.equal(summary.metrics.pasteFinishedLatencyMs, 660);
  assert.equal(summary.metrics.insertedLatencyMs, 665);
  assert.equal(summary.metrics.pasteRoundTripMs, 60);
  assert.equal(summary.metrics.totalLatencyMs, 665);
  assert.equal(summary.flags.fallbackUsed, false);
  assert.equal(summary.flags.permissionRequired, false);
  assert.equal(summary.flags.errorSeen, false);
  assert.equal(summary.events.length, 9);
});

test("ASR session timeline exposes fallback and permission flags from lifecycle events", async () => {
  const mod = await import(modulePath);

  const timeline = mod.createAsrSessionTimeline({
    sessionId: "asr_session_flag_test",
    startedAtMs: 10,
  });

  mod.markAsrSessionEvent(timeline, "fallback_used", { source: "openai-fallback" }, 30);
  mod.markAsrSessionEvent(timeline, "permission_required", { scope: "microphone" }, 45);
  mod.markAsrSessionEvent(timeline, "error", { code: "AUTH_REQUIRED" }, 55);

  const summary = mod.finalizeAsrSessionTimeline(timeline, {
    status: "error",
    completedAtMs: 55,
  });

  assert.equal(summary.flags.fallbackUsed, true);
  assert.equal(summary.flags.permissionRequired, true);
  assert.equal(summary.flags.errorSeen, true);
  assert.equal(summary.metrics.totalLatencyMs, 45);
});

test("ASR feature flags resolve stable defaults and honor explicit overrides", async () => {
  const mod = await import(flagsModulePath);

  const defaults = mod.resolveAsrFeatureFlags();
  assert.equal(defaults.sessionTimeline, true);
  assert.equal(defaults.replayHarness, true);
  assert.equal(defaults.formalDictationState, true);
  assert.equal(defaults.unifiedSessionContract, false);
  assert.equal(defaults.multiStateVad, true);
  assert.equal(defaults.incrementalStabilizer, true);

  const overridden = mod.resolveAsrFeatureFlags({
    env: {
      MOUTHPIECE_ASR_MULTI_STATE_VAD: "0",
      MOUTHPIECE_ASR_UNIFIED_SESSION_CONTRACT: "true",
    },
    overrides: {
      replayHarness: false,
      incrementalStabilizer: false,
    },
  });

  assert.equal(overridden.multiStateVad, false);
  assert.equal(overridden.unifiedSessionContract, true);
  assert.equal(overridden.replayHarness, false);
  assert.equal(overridden.incrementalStabilizer, false);
});
