export const DICTATION_SESSION_STATES = Object.freeze({
  IDLE: "Idle",
  ARMING: "Arming",
  LISTENING: "Listening",
  SPEECH_DETECTED: "SpeechDetected",
  PROCESSING: "Processing",
  PARTIAL_STABLE: "PartialStable",
  FINALIZING: "Finalizing",
  INSERTED: "Inserted",
  ERROR: "Error",
  PERMISSION_REQUIRED: "PermissionRequired",
  OFFLINE_FALLBACK: "OfflineFallback",
});

const ACTIVE_DICTATION_STATES = new Set([
  DICTATION_SESSION_STATES.ARMING,
  DICTATION_SESSION_STATES.LISTENING,
  DICTATION_SESSION_STATES.SPEECH_DETECTED,
  DICTATION_SESSION_STATES.PROCESSING,
  DICTATION_SESSION_STATES.PARTIAL_STABLE,
  DICTATION_SESSION_STATES.FINALIZING,
  DICTATION_SESSION_STATES.OFFLINE_FALLBACK,
]);

export function getDictationSessionState({
  dictationState = null,
  isStarting = false,
  isRecording = false,
  isProcessing = false,
  isTranscribing = false,
  sessionSummary = null,
} = {}) {
  if (dictationState) {
    return dictationState;
  }

  const lastEventType = sessionSummary?.lastEventType ?? null;
  const flags = sessionSummary?.flags || {};

  if (flags.permissionRequired || lastEventType === "permission_required") {
    return DICTATION_SESSION_STATES.PERMISSION_REQUIRED;
  }

  if (sessionSummary?.status === "error" || flags.errorSeen || lastEventType === "error") {
    return DICTATION_SESSION_STATES.ERROR;
  }

  if (sessionSummary?.status === "inserted" || lastEventType === "inserted") {
    return DICTATION_SESSION_STATES.INSERTED;
  }

  if (flags.fallbackUsed || lastEventType === "fallback_used") {
    return DICTATION_SESSION_STATES.OFFLINE_FALLBACK;
  }

  if (isProcessing && lastEventType === "final_ready") {
    return DICTATION_SESSION_STATES.FINALIZING;
  }

  if (isProcessing || isTranscribing) {
    return DICTATION_SESSION_STATES.PROCESSING;
  }

  if (isStarting) {
    return DICTATION_SESSION_STATES.ARMING;
  }

  if (lastEventType === "first_stable_partial") {
    return DICTATION_SESSION_STATES.PARTIAL_STABLE;
  }

  if (isRecording && lastEventType === "speech_detected") {
    return DICTATION_SESSION_STATES.SPEECH_DETECTED;
  }

  if (isRecording && lastEventType === "capture_ready") {
    return DICTATION_SESSION_STATES.LISTENING;
  }

  if (isRecording) {
    return DICTATION_SESSION_STATES.ARMING;
  }

  return DICTATION_SESSION_STATES.IDLE;
}

export function isActiveDictationSessionState(dictationState) {
  return ACTIVE_DICTATION_STATES.has(dictationState);
}
