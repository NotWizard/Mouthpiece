export const AUDIO_QUALITY_MODES = Object.freeze(["noise_reduction", "balanced", "low_latency"]);
export const VOICE_GATE_STRICTNESS_LEVELS = Object.freeze(["relaxed", "standard", "strict"]);
export const REALTIME_ENDPOINTING_MODES = Object.freeze(["fast", "balanced", "patient"]);

export const DEFAULT_AUDIO_QUALITY_MODE = "noise_reduction";
export const DEFAULT_VOICE_GATE_STRICTNESS = "standard";
export const DEFAULT_REALTIME_ENDPOINTING_MODE = "balanced";

function normalizeChoice(value, choices, fallback) {
  return choices.includes(value) ? value : fallback;
}

export function normalizeAudioQualityMode(value) {
  return normalizeChoice(value, AUDIO_QUALITY_MODES, DEFAULT_AUDIO_QUALITY_MODE);
}

export function normalizeVoiceGateStrictness(value) {
  return normalizeChoice(value, VOICE_GATE_STRICTNESS_LEVELS, DEFAULT_VOICE_GATE_STRICTNESS);
}

export function normalizeRealtimeEndpointingMode(value) {
  return normalizeChoice(value, REALTIME_ENDPOINTING_MODES, DEFAULT_REALTIME_ENDPOINTING_MODE);
}

export function getAudioProcessingConstraints(mode = DEFAULT_AUDIO_QUALITY_MODE) {
  const normalizedMode = normalizeAudioQualityMode(mode);

  if (normalizedMode === "low_latency") {
    return {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
  }

  if (normalizedMode === "balanced") {
    return {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: false },
    };
  }

  return {
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: false },
  };
}

const QUALITY_GATE_PROFILES = Object.freeze({
  noise_reduction: {
    minSpeechRms: 0.022,
    openSnrDb: 10,
    closeSnrDb: 6,
    minSpeechMs: 220,
    hangoverMs: 320,
    preRollMs: 300,
    minVoicedRatio: 0.08,
    minSpeechFrames: 4,
  },
  balanced: {
    minSpeechRms: 0.016,
    openSnrDb: 8,
    closeSnrDb: 5,
    minSpeechMs: 170,
    hangoverMs: 260,
    preRollMs: 250,
    minVoicedRatio: 0.06,
    minSpeechFrames: 3,
  },
  low_latency: {
    minSpeechRms: 0.009,
    openSnrDb: 5,
    closeSnrDb: 3,
    minSpeechMs: 100,
    hangoverMs: 180,
    preRollMs: 120,
    minVoicedRatio: 0.03,
    minSpeechFrames: 2,
  },
});

const STRICTNESS_ADJUSTMENTS = Object.freeze({
  relaxed: {
    minSpeechRms: -0.004,
    openSnrDb: -2,
    closeSnrDb: -1,
    minSpeechMs: -40,
    hangoverMs: 80,
    minVoicedRatio: -0.02,
    minSpeechFrames: -1,
  },
  standard: {
    minSpeechRms: 0,
    openSnrDb: 0,
    closeSnrDb: 0,
    minSpeechMs: 0,
    hangoverMs: 0,
    minVoicedRatio: 0,
    minSpeechFrames: 0,
  },
  strict: {
    minSpeechRms: 0.006,
    openSnrDb: 3,
    closeSnrDb: 2,
    minSpeechMs: 80,
    hangoverMs: -40,
    minVoicedRatio: 0.04,
    minSpeechFrames: 2,
  },
});

export function getVoiceGateConfig({
  audioQualityMode = DEFAULT_AUDIO_QUALITY_MODE,
  voiceGateStrictness = DEFAULT_VOICE_GATE_STRICTNESS,
} = {}) {
  const mode = normalizeAudioQualityMode(audioQualityMode);
  const strictness = normalizeVoiceGateStrictness(voiceGateStrictness);
  const profile = QUALITY_GATE_PROFILES[mode];
  const adjustment = STRICTNESS_ADJUSTMENTS[strictness];

  return {
    sampleRate: 16000,
    frameMs: 50,
    minSpeechRms: Math.max(0.001, profile.minSpeechRms + adjustment.minSpeechRms),
    openSnrDb: Math.max(1, profile.openSnrDb + adjustment.openSnrDb),
    closeSnrDb: Math.max(0, profile.closeSnrDb + adjustment.closeSnrDb),
    minSpeechMs: Math.max(50, profile.minSpeechMs + adjustment.minSpeechMs),
    hangoverMs: Math.max(80, profile.hangoverMs + adjustment.hangoverMs),
    preRollMs: Math.max(0, profile.preRollMs),
    minVoicedRatio: Math.max(0, profile.minVoicedRatio + adjustment.minVoicedRatio),
    minSpeechFrames: Math.max(1, profile.minSpeechFrames + adjustment.minSpeechFrames),
  };
}

export function getRealtimeEndpointingConfig(
  mode = DEFAULT_REALTIME_ENDPOINTING_MODE,
  provider = "deepgram"
) {
  const normalizedMode = normalizeRealtimeEndpointingMode(mode);

  if (provider === "deepgram") {
    if (normalizedMode === "fast") {
      return { endpointing: 350, utteranceEndMs: 700 };
    }
    if (normalizedMode === "patient") {
      return { endpointing: 700, utteranceEndMs: 1400 };
    }
    return { endpointing: 500, utteranceEndMs: 1000 };
  }

  if (provider === "bailian") {
    if (normalizedMode === "fast") {
      return { silenceDurationMs: 650 };
    }
    if (normalizedMode === "patient") {
      return { silenceDurationMs: 1100 };
    }
    return { silenceDurationMs: 800 };
  }

  return {};
}
