import { DICTATION_CAPSULE_WIDTH_PX } from "./dictationOverlayState.mjs";

export const DICTATION_CAPSULE_MORPH_DURATION_MS = 280;
export const DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS = 170;

const RECORDING_LAYOUT = Object.freeze({
  widthPx: DICTATION_CAPSULE_WIDTH_PX,
  heightPx: 72,
  borderRadiusPx: 22,
});

const PREVIEW_LAYOUT = Object.freeze({
  widthPx: DICTATION_CAPSULE_WIDTH_PX,
  heightPx: 92,
  borderRadiusPx: 22,
});

const TRANSCRIBING_LAYOUT = Object.freeze({
  widthPx: 132,
  heightPx: 46,
  borderRadiusPx: 16,
});

export function getDictationCapsuleStage({ isTranscribing, elapsedMs = 0 }) {
  if (!isTranscribing) {
    return "recording";
  }

  return elapsedMs >= DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS ? "transcribing" : "collapsing";
}

export function getDictationCapsuleLayout({ stage }) {
  if (stage === "preview") {
    return PREVIEW_LAYOUT;
  }

  return stage === "recording" ? RECORDING_LAYOUT : TRANSCRIBING_LAYOUT;
}

export function getDictationCapsuleVisualState({ isTranscribing, elapsedMs = 0 }) {
  const stage = getDictationCapsuleStage({ isTranscribing, elapsedMs });

  if (stage === "recording") {
    return {
      stage,
      showRecordingContent: true,
      showMorphIndicator: false,
      showCompactContent: false,
    };
  }

  if (stage === "collapsing") {
    return {
      stage,
      showRecordingContent: false,
      showMorphIndicator: true,
      showCompactContent: false,
    };
  }

  return {
    stage,
    showRecordingContent: false,
    showMorphIndicator: false,
    showCompactContent: true,
  };
}
