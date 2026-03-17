export const DICTATION_CAPSULE_BOTTOM_OFFSET_PX = 15;
export const DICTATION_CAPSULE_WIDTH_PX = 308;
export const DICTATION_WINDOW_IDLE_HIDE_DELAY_MS = 120;

export function shouldShowDictationCapsule({ isRecording, isTranscribing }) {
  return Boolean(isRecording || isTranscribing);
}

export function shouldKeepDictationWindowVisible({ isRecording, isTranscribing, isCommandMenuOpen, toastCount }) {
  return Boolean(isRecording || isTranscribing || isCommandMenuOpen || toastCount > 0);
}
