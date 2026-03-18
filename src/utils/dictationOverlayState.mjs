export const DICTATION_CAPSULE_BOTTOM_OFFSET_PX = 15;
export const DICTATION_CAPSULE_WIDTH_PX = 308;
export const DICTATION_WINDOW_IDLE_HIDE_DELAY_MS = 120;

export function isDictationActive({ isRecording, isTranscribing, isProcessing }) {
  return Boolean(isRecording || isTranscribing || isProcessing);
}

export function shouldShowDictationCapsule({ isRecording, isTranscribing, isProcessing }) {
  return isDictationActive({ isRecording, isTranscribing, isProcessing });
}

export function shouldKeepDictationWindowVisible({
  isRecording,
  isTranscribing,
  isProcessing,
  isCommandMenuOpen,
  toastCount,
}) {
  return Boolean(
    isDictationActive({ isRecording, isTranscribing, isProcessing }) ||
      isCommandMenuOpen ||
      toastCount > 0
  );
}

export function shouldCaptureDictationWindowInput({
  isRecording,
  isTranscribing,
  isProcessing,
  isCommandMenuOpen,
  toastCount,
}) {
  return Boolean(
    isDictationActive({ isRecording, isTranscribing, isProcessing }) ||
      isCommandMenuOpen ||
      toastCount > 0
  );
}
