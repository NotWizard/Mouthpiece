import { getVoiceGateConfig } from "./audioQualitySettings.mjs";

const NOISE_ALPHA = 0.08;
const ACTIVE_NOISE_ALPHA = 0.015;
const MIN_NOISE_FLOOR = 0.0015;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function sanitizeNumber(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function toSampleView(samples) {
  if (samples instanceof ArrayBuffer) {
    return new Int16Array(samples);
  }
  if (ArrayBuffer.isView(samples)) {
    return samples;
  }
  return new Float32Array();
}

export function computeFrameRms(samples) {
  const view = toSampleView(samples);
  if (!view.length) return 0;

  const divisor = view instanceof Int16Array ? 32768 : 1;
  let sumSquares = 0;
  for (let index = 0; index < view.length; index += 1) {
    const sample = Number(view[index]) / divisor;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / view.length);
}

function computeSnrDb(rms, noiseFloor) {
  const safeNoiseFloor = Math.max(MIN_NOISE_FLOOR, sanitizeNumber(noiseFloor, MIN_NOISE_FLOOR));
  const safeRms = Math.max(MIN_NOISE_FLOOR, sanitizeNumber(rms, 0));
  return 20 * Math.log10(safeRms / safeNoiseFloor);
}

function estimateSpeechProbability({ rms, snrDb, config }) {
  const rmsScore = (rms - config.minSpeechRms) / Math.max(config.minSpeechRms, 0.001);
  const snrScore = (snrDb - config.openSnrDb) / Math.max(config.openSnrDb, 1);
  return clamp01((rmsScore + snrScore) / 2);
}

function blendNoiseFloor(noiseFloor, rms, active = false) {
  const current = Math.max(MIN_NOISE_FLOOR, sanitizeNumber(noiseFloor, MIN_NOISE_FLOOR));
  const nextRms = Math.max(MIN_NOISE_FLOOR, sanitizeNumber(rms, 0));
  const alpha = active ? ACTIVE_NOISE_ALPHA : NOISE_ALPHA;
  return current + (nextRms - current) * alpha;
}

function clonePreRoll(preRollFrames = []) {
  return preRollFrames.map((entry) => ({ ...entry }));
}

function trimPreRoll(preRollFrames, maxFrames) {
  if (preRollFrames.length <= maxFrames) return preRollFrames;
  return preRollFrames.slice(preRollFrames.length - maxFrames);
}

export function createSpeechActivityGateState(overrides = {}) {
  return {
    gateState: "idle",
    activeMs: 0,
    silenceMs: 0,
    noiseFloor: MIN_NOISE_FLOOR,
    speechDetected: false,
    speechDetectedEver: false,
    lastRms: 0,
    lastSnrDb: 0,
    maxSpeechProbability: 0,
    voicedFrameCount: 0,
    totalFrameCount: 0,
    preRollFrames: [],
    ...overrides,
  };
}

export function getSpeechActivityGateConfig(options = {}) {
  return getVoiceGateConfig(options);
}

export function advanceSpeechActivityGate(state, samples, config = getSpeechActivityGateConfig()) {
  const previousState =
    state && typeof state === "object"
      ? {
          ...createSpeechActivityGateState(),
          ...state,
          preRollFrames: clonePreRoll(state.preRollFrames),
        }
      : createSpeechActivityGateState();
  const safeConfig = { ...getSpeechActivityGateConfig(), ...(config || {}) };
  const frameMs = Math.max(1, sanitizeNumber(safeConfig.frameMs, 50));
  const preRollMaxFrames = Math.max(0, Math.ceil(safeConfig.preRollMs / frameMs));
  const rms = computeFrameRms(samples);
  const snrDb = computeSnrDb(rms, previousState.noiseFloor);
  const speechProbability = estimateSpeechProbability({ rms, snrDb, config: safeConfig });
  const aboveOpen = rms >= safeConfig.minSpeechRms && snrDb >= safeConfig.openSnrDb;
  const aboveClose =
    rms >= Math.max(0.001, safeConfig.minSpeechRms * 0.62) && snrDb >= safeConfig.closeSnrDb;

  let gateState = previousState.gateState;
  let activeMs = previousState.activeMs;
  let silenceMs = previousState.silenceMs;
  let speechDetected = false;
  let framesToSend = [];
  let preRollFrames = trimPreRoll(
    [
      ...previousState.preRollFrames,
      {
        samples,
        rms,
        snrDb,
      },
    ],
    preRollMaxFrames
  );

  if (gateState === "speaking" || gateState === "hangover") {
    if (aboveClose) {
      gateState = "speaking";
      activeMs = Math.max(safeConfig.minSpeechMs, activeMs + frameMs);
      silenceMs = 0;
      speechDetected = true;
      framesToSend = [{ samples, rms, snrDb }];
    } else {
      silenceMs += frameMs;
      if (silenceMs <= safeConfig.hangoverMs) {
        gateState = "hangover";
        speechDetected = true;
        framesToSend = [{ samples, rms, snrDb }];
      } else {
        gateState = "idle";
        activeMs = 0;
        silenceMs = 0;
        speechDetected = false;
        preRollFrames = [];
      }
    }
  } else if (aboveOpen) {
    gateState = "pre_speech";
    activeMs += frameMs;
    silenceMs = 0;
    if (activeMs >= safeConfig.minSpeechMs) {
      gateState = "speaking";
      speechDetected = true;
      framesToSend = preRollFrames;
      preRollFrames = [];
    }
  } else {
    gateState = "idle";
    activeMs = 0;
    silenceMs = 0;
  }

  const activeForNoise = gateState === "speaking" || gateState === "hangover" || aboveOpen;
  const noiseFloor = blendNoiseFloor(previousState.noiseFloor, rms, activeForNoise);
  const speechDetectedEver = previousState.speechDetectedEver || speechDetected;
  const voicedFrameCount = previousState.voicedFrameCount + (speechDetected ? 1 : 0);
  const totalFrameCount = previousState.totalFrameCount + 1;

  return {
    speechDetected,
    speechProbability,
    snrDb,
    rms,
    framesToSend,
    state: {
      ...previousState,
      gateState,
      activeMs,
      silenceMs,
      noiseFloor,
      speechDetected,
      speechDetectedEver,
      lastRms: rms,
      lastSnrDb: snrDb,
      maxSpeechProbability: Math.max(previousState.maxSpeechProbability, speechProbability),
      voicedFrameCount,
      totalFrameCount,
      preRollFrames,
    },
  };
}

export function createSilenceFrameLike(samples) {
  const view = toSampleView(samples);
  if (samples instanceof ArrayBuffer) {
    return new ArrayBuffer(samples.byteLength);
  }
  if (view instanceof Int16Array) {
    return new Int16Array(view.length).buffer;
  }
  if (view instanceof Float32Array) {
    return new Float32Array(view.length);
  }
  return new ArrayBuffer(view.byteLength || 0);
}

export function analyzeSpeechActivity(samples, config = getSpeechActivityGateConfig()) {
  const view = toSampleView(samples);
  const safeConfig = { ...getSpeechActivityGateConfig(), ...(config || {}) };
  const samplesPerFrame = Math.max(
    1,
    Math.round((safeConfig.sampleRate * safeConfig.frameMs) / 1000)
  );
  let state = createSpeechActivityGateState();
  let firstSpeechFrame = null;
  let lastConfidentSpeechFrame = null;

  for (
    let offset = 0, frameIndex = 0;
    offset < view.length;
    offset += samplesPerFrame, frameIndex += 1
  ) {
    const frame = view.subarray(offset, Math.min(view.length, offset + samplesPerFrame));
    const result = advanceSpeechActivityGate(state, frame, safeConfig);
    state = result.state;
    if (result.speechDetected) {
      if (firstSpeechFrame === null) firstSpeechFrame = frameIndex;
    }
    if (result.rms >= safeConfig.minSpeechRms && result.snrDb >= safeConfig.closeSnrDb) {
      lastConfidentSpeechFrame = frameIndex;
    }
  }

  const voicedRatio =
    state.totalFrameCount > 0 ? state.voicedFrameCount / state.totalFrameCount : 0;
  const shouldTranscribe =
    state.speechDetectedEver &&
    state.voicedFrameCount >= safeConfig.minSpeechFrames &&
    voicedRatio >= safeConfig.minVoicedRatio;
  const preRollFrames = Math.ceil(safeConfig.preRollMs / safeConfig.frameMs);
  const tailFrames = Math.min(2, Math.ceil(safeConfig.hangoverMs / safeConfig.frameMs));
  const trimStartFrame =
    firstSpeechFrame === null ? 0 : Math.max(0, firstSpeechFrame - preRollFrames);
  const trimEndFrame =
    lastConfidentSpeechFrame === null
      ? 0
      : Math.min(
          Math.ceil(view.length / samplesPerFrame),
          lastConfidentSpeechFrame + tailFrames + 1
        );

  return {
    shouldTranscribe,
    voicedRatio,
    voicedFrameCount: state.voicedFrameCount,
    totalFrameCount: state.totalFrameCount,
    maxSpeechProbability: state.maxSpeechProbability,
    noiseFloor: state.noiseFloor,
    trimStartSample: trimStartFrame * samplesPerFrame,
    trimEndSample: Math.min(view.length, trimEndFrame * samplesPerFrame),
  };
}
