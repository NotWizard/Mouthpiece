// Single, hardcoded audio-quality preset.
// Earlier versions exposed three modes (noise_reduction / balanced / low_latency)
// and a separate strictness slider on top of them, but the user-visible knobs
// were either no-ops for the streaming providers we ship or silently disabled
// the gate entirely. The single bake-in below uses the historical
// "noise_reduction" + "standard" combination, which prioritizes false-record
// rejection — the original intent of the panel.

const VOICE_GATE_PROFILE = Object.freeze({
  sampleRate: 16000,
  frameMs: 50,
  minSpeechRms: 0.022,
  openSnrDb: 10,
  closeSnrDb: 6,
  minSpeechMs: 220,
  hangoverMs: 320,
  preRollMs: 300,
  minVoicedRatio: 0.08,
  minSpeechFrames: 4,
});

const AUDIO_PROCESSING_CONSTRAINTS = Object.freeze({
  echoCancellation: { ideal: true },
  noiseSuppression: { ideal: true },
  autoGainControl: { ideal: false },
});

const REALTIME_ENDPOINTING_BY_PROVIDER = Object.freeze({
  deepgram: { endpointing: 500, utteranceEndMs: 1000 },
  bailian: { silenceDurationMs: 1200 },
});

export function getAudioProcessingConstraints() {
  return { ...AUDIO_PROCESSING_CONSTRAINTS };
}

export function getVoiceGateConfig() {
  return { ...VOICE_GATE_PROFILE };
}

export function getRealtimeEndpointingConfig(provider = "deepgram") {
  const preset = REALTIME_ENDPOINTING_BY_PROVIDER[provider];
  return preset ? { ...preset } : {};
}
