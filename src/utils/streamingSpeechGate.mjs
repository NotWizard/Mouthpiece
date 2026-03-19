export const STREAMING_SILENCE_THRESHOLD = 0.01;
export const STREAMING_SPEECH_GATE_MIN_ACTIVE_MS = 160;

export function advanceStreamingSpeechGate(
  state,
  {
    rms = 0,
    frameMs = 80,
    threshold = STREAMING_SILENCE_THRESHOLD,
    minActiveMs = STREAMING_SPEECH_GATE_MIN_ACTIVE_MS,
  } = {}
) {
  const previousState =
    state && typeof state === "object"
      ? state
      : {
          activeMs: 0,
          speechDetected: false,
        };

  if (previousState.speechDetected) {
    return {
      activeMs: Math.max(previousState.activeMs || 0, minActiveMs),
      speechDetected: true,
    };
  }

  const safeRms = Number.isFinite(rms) ? Number(rms) : 0;
  const safeFrameMs = Math.max(0, Number.isFinite(frameMs) ? Number(frameMs) : 0);
  const nextActiveMs = safeRms >= threshold ? (previousState.activeMs || 0) + safeFrameMs : 0;

  return {
    activeMs: nextActiveMs,
    speechDetected: nextActiveMs >= minActiveMs,
  };
}

export function shouldDiscardStreamingTranscript({
  speechDetected = false,
  peakRms = 0,
  threshold = STREAMING_SILENCE_THRESHOLD,
} = {}) {
  const safePeakRms = Number.isFinite(peakRms) ? Number(peakRms) : 0;
  return !speechDetected && safePeakRms < threshold;
}
