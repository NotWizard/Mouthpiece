export const STREAMING_SILENCE_THRESHOLD = 0.01;
export const STREAMING_SPEECH_GATE_MIN_ACTIVE_MS = 160;
export const STREAMING_SPEECH_GATE_HANGOVER_MS = 240;

const STREAMING_SPEECH_GATE_NOISE_ALPHA = 0.25;
const STREAMING_SPEECH_GATE_NOISE_MARGIN = 0.007;
const STREAMING_SPEECH_GATE_RISE_DELTA = 0.0005;
const STREAMING_SPEECH_GATE_STRONG_MULTIPLIER = 1.6;
const STREAMING_SPEECH_GATE_STEADY_OPEN_MARGIN = 0.002;

function sanitizeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function clampMilliseconds(value) {
  return Math.max(0, sanitizeNumber(value, 0));
}

function computeThreshold(noiseFloor, baseThreshold) {
  return Math.max(baseThreshold, sanitizeNumber(noiseFloor, 0) + STREAMING_SPEECH_GATE_NOISE_MARGIN);
}

function blendNoiseFloor(currentNoiseFloor, rms) {
  const safeNoiseFloor = Math.max(0, sanitizeNumber(currentNoiseFloor, 0));
  const safeRms = Math.max(0, sanitizeNumber(rms, 0));
  return safeNoiseFloor + (safeRms - safeNoiseFloor) * STREAMING_SPEECH_GATE_NOISE_ALPHA;
}

export function createStreamingSpeechGateState(overrides = {}) {
  return {
    stage: "idle",
    activeMs: 0,
    silenceMs: 0,
    noiseFloor: 0,
    threshold: STREAMING_SILENCE_THRESHOLD,
    speechDetected: false,
    lastRms: 0,
    ...overrides,
  };
}

export function advanceStreamingSpeechGate(
  state,
  {
    rms = 0,
    frameMs = 80,
    threshold = STREAMING_SILENCE_THRESHOLD,
    minActiveMs = STREAMING_SPEECH_GATE_MIN_ACTIVE_MS,
    hangoverMs = STREAMING_SPEECH_GATE_HANGOVER_MS,
  } = {}
) {
  const previousState =
    state && typeof state === "object"
      ? { ...createStreamingSpeechGateState(), ...state }
      : createStreamingSpeechGateState();

  const safeRms = Math.max(0, sanitizeNumber(rms, 0));
  const safeFrameMs = clampMilliseconds(frameMs);
  const safeThreshold = Math.max(0, sanitizeNumber(threshold, STREAMING_SILENCE_THRESHOLD));
  const safeMinActiveMs = Math.max(0, sanitizeNumber(minActiveMs, STREAMING_SPEECH_GATE_MIN_ACTIVE_MS));
  const safeHangoverMs = Math.max(
    0,
    sanitizeNumber(hangoverMs, STREAMING_SPEECH_GATE_HANGOVER_MS)
  );
  const previousThreshold = computeThreshold(previousState.noiseFloor, safeThreshold);
  const strongSpeechThreshold = Math.max(
    previousThreshold * STREAMING_SPEECH_GATE_STRONG_MULTIPLIER,
    previousThreshold + STREAMING_SPEECH_GATE_NOISE_MARGIN
  );
  const isAboveThreshold = safeRms >= previousThreshold;
  const isRisingSpeech = safeRms > sanitizeNumber(previousState.lastRms, 0) + STREAMING_SPEECH_GATE_RISE_DELTA;
  const isStrongSpeech = safeRms >= strongSpeechThreshold;
  const isSteadyNearThreshold =
    previousThreshold <= STREAMING_SILENCE_THRESHOLD &&
    safeRms <= previousThreshold + STREAMING_SPEECH_GATE_STEADY_OPEN_MARGIN;

  const buildIdleState = (noiseFloor) =>
    createStreamingSpeechGateState({
      noiseFloor,
      threshold: computeThreshold(noiseFloor, safeThreshold),
      lastRms: safeRms,
    });

  if (previousState.stage === "speaking" || previousState.stage === "hangover") {
    if (isAboveThreshold) {
      return {
        ...previousState,
        stage: "speaking",
        activeMs: Math.max(safeMinActiveMs, previousState.activeMs + safeFrameMs),
        silenceMs: 0,
        threshold: previousThreshold,
        speechDetected: true,
        lastRms: safeRms,
      };
    }

    const silenceMs = previousState.silenceMs + safeFrameMs;
    const noiseFloor = blendNoiseFloor(previousState.noiseFloor, safeRms);

    if (silenceMs >= safeHangoverMs) {
      return buildIdleState(noiseFloor);
    }

    return {
      ...previousState,
      stage: "hangover",
      silenceMs,
      noiseFloor,
      threshold: computeThreshold(noiseFloor, safeThreshold),
      speechDetected: true,
      lastRms: safeRms,
    };
  }

  if (!isAboveThreshold) {
    const noiseFloor = blendNoiseFloor(previousState.noiseFloor, safeRms);
    return buildIdleState(noiseFloor);
  }

  if (
    previousState.stage === "pre_speech" &&
    !isRisingSpeech &&
    !isStrongSpeech &&
    !isSteadyNearThreshold
  ) {
    const noiseFloor = blendNoiseFloor(previousState.noiseFloor, safeRms);
    return buildIdleState(noiseFloor);
  }

  const nextActiveMs =
    previousState.stage === "pre_speech" ? previousState.activeMs + safeFrameMs : safeFrameMs;
  const speechDetected = nextActiveMs >= safeMinActiveMs;

  return {
    ...previousState,
    stage: speechDetected ? "speaking" : "pre_speech",
    activeMs: nextActiveMs,
    silenceMs: 0,
    threshold: previousThreshold,
    speechDetected,
    lastRms: safeRms,
  };
}

export function shouldDiscardStreamingTranscript({
  speechDetectedEver = false,
  peakRms = 0,
  threshold = STREAMING_SILENCE_THRESHOLD,
} = {}) {
  const safePeakRms = Math.max(0, sanitizeNumber(peakRms, 0));
  const safeThreshold = Math.max(0, sanitizeNumber(threshold, STREAMING_SILENCE_THRESHOLD));
  return !speechDetectedEver && safePeakRms < safeThreshold;
}
