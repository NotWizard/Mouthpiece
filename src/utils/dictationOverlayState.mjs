export const DICTATION_CAPSULE_BOTTOM_OFFSET_PX = 15;
export const DICTATION_CAPSULE_WIDTH_PX = 384;
export const DICTATION_WINDOW_IDLE_HIDE_DELAY_MS = 120;

export function shouldShowDictationCapsule({ isRecording }) {
  return Boolean(isRecording);
}

export function shouldKeepDictationWindowVisible({
  isRecording,
  isCommandMenuOpen,
  toastCount,
}) {
  return Boolean(isRecording || isCommandMenuOpen || toastCount > 0);
}
