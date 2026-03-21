import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const sessionStateModulePath = path.resolve(process.cwd(), "src/utils/dictationSessionState.mjs");
const overlayStateModulePath = path.resolve(process.cwd(), "src/utils/dictationOverlayState.mjs");

test("formal dictation state resolves the core session lifecycle", async () => {
  const mod = await import(sessionStateModulePath);

  assert.equal(mod.getDictationSessionState({}), mod.DICTATION_SESSION_STATES.IDLE);
  assert.equal(
    mod.getDictationSessionState({
      isRecording: true,
      sessionSummary: { lastEventType: "session_started" },
    }),
    mod.DICTATION_SESSION_STATES.ARMING
  );
  assert.equal(
    mod.getDictationSessionState({
      isRecording: true,
      sessionSummary: { lastEventType: "capture_ready" },
    }),
    mod.DICTATION_SESSION_STATES.LISTENING
  );
  assert.equal(
    mod.getDictationSessionState({
      isRecording: true,
      sessionSummary: { lastEventType: "speech_detected" },
    }),
    mod.DICTATION_SESSION_STATES.SPEECH_DETECTED
  );
  assert.equal(
    mod.getDictationSessionState({
      isRecording: true,
      sessionSummary: { lastEventType: "first_stable_partial" },
    }),
    mod.DICTATION_SESSION_STATES.PARTIAL_STABLE
  );
  assert.equal(
    mod.getDictationSessionState({
      isProcessing: true,
      isTranscribing: true,
      sessionSummary: { lastEventType: "final_ready" },
    }),
    mod.DICTATION_SESSION_STATES.FINALIZING
  );
  assert.equal(
    mod.getDictationSessionState({
      sessionSummary: { lastEventType: "inserted", status: "inserted" },
    }),
    mod.DICTATION_SESSION_STATES.INSERTED
  );
  assert.equal(
    mod.getDictationSessionState({
      sessionSummary: { lastEventType: "fallback_used", flags: { fallbackUsed: true } },
    }),
    mod.DICTATION_SESSION_STATES.OFFLINE_FALLBACK
  );
  assert.equal(
    mod.getDictationSessionState({
      sessionSummary: { lastEventType: "permission_required", flags: { permissionRequired: true } },
    }),
    mod.DICTATION_SESSION_STATES.PERMISSION_REQUIRED
  );
  assert.equal(
    mod.getDictationSessionState({
      sessionSummary: { lastEventType: "error", status: "error", flags: { errorSeen: true } },
    }),
    mod.DICTATION_SESSION_STATES.ERROR
  );
});

test("overlay visibility helpers accept a formal dictation state as the single source of truth", async () => {
  const sessionStateMod = await import(sessionStateModulePath);
  const overlayMod = await import(overlayStateModulePath);

  assert.equal(
    overlayMod.isDictationActive({
      dictationState: sessionStateMod.DICTATION_SESSION_STATES.LISTENING,
    }),
    true
  );
  assert.equal(
    overlayMod.isDictationActive({
      dictationState: sessionStateMod.DICTATION_SESSION_STATES.IDLE,
    }),
    false
  );
  assert.equal(
    overlayMod.shouldShowDictationCapsule({
      dictationState: sessionStateMod.DICTATION_SESSION_STATES.FINALIZING,
    }),
    true
  );
  assert.equal(
    overlayMod.shouldKeepDictationWindowVisible({
      dictationState: sessionStateMod.DICTATION_SESSION_STATES.INSERTED,
      isCommandMenuOpen: false,
      toastCount: 0,
    }),
    false
  );
  assert.equal(
    overlayMod.shouldCaptureDictationWindowInput({
      dictationState: sessionStateMod.DICTATION_SESSION_STATES.ERROR,
      isCommandMenuOpen: false,
      toastCount: 0,
    }),
    false
  );
});
