import {
  getDictationSessionState,
  isActiveDictationSessionState,
} from "./dictationSessionState.mjs";

export const DICTATION_CAPSULE_BOTTOM_OFFSET_PX = 15;
export const DICTATION_CAPSULE_WIDTH_PX = 308;
export const DICTATION_WINDOW_IDLE_HIDE_DELAY_MS = 120;

function resolveDictationState(input) {
  return getDictationSessionState(input);
}

export function isDictationActive(input = {}) {
  return isActiveDictationSessionState(resolveDictationState(input));
}

export function shouldShowDictationCapsule(input = {}) {
  return isDictationActive(input);
}

export function shouldKeepDictationWindowVisible({
  dictationState,
  isRecording,
  isTranscribing,
  isProcessing,
  isCommandMenuOpen,
  toastCount,
}) {
  return Boolean(
    isDictationActive({ dictationState, isRecording, isTranscribing, isProcessing }) ||
      isCommandMenuOpen ||
      toastCount > 0
  );
}

export function shouldCaptureDictationWindowInput({
  dictationState,
  isRecording,
  isTranscribing,
  isProcessing,
  isCommandMenuOpen,
  toastCount,
}) {
  return Boolean(
    isDictationActive({ dictationState, isRecording, isTranscribing, isProcessing }) ||
      isCommandMenuOpen ||
      toastCount > 0
  );
}
