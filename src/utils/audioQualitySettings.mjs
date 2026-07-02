// Single, hardcoded audio-quality preset.
// Earlier versions exposed three modes (noise_reduction / balanced / low_latency)
// and a separate strictness slider on top of them, but the user-visible knobs
// were either no-ops for the streaming providers we ship or silently disabled
// the gate entirely. The single bake-in below uses the historical
// "noise_reduction" + "standard" combination, with two values brought into
// industry-consensus range during the bake-in:
//   - minSpeechRms relaxed from 0.022 (~-33 dBFS) to 0.014 (~-37 dBFS) so
//     soft / distant voices are not dropped at the gate (aligned with the
//     Minuta / GPT-SoVITS practical floor of -38 dBFS).
//   - noiseSuppression flipped from true to false because Deepgram's
//     streaming-transcription Decision Matrix recommends disabling
//     browser-side NS, and community evidence from Whisper desktop projects
//     shows it strips speech-band detail and shortens word onsets / offsets.

const VOICE_GATE_PROFILE = Object.freeze({
  sampleRate: 16000,
  frameMs: 50,
  minSpeechRms: 0.014,
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
  noiseSuppression: { ideal: false },
  autoGainControl: { ideal: false },
});

const REALTIME_ENDPOINTING_BY_PROVIDER = Object.freeze({
  deepgram: { endpointing: 500, utteranceEndMs: 1000 },
  bailian: { silenceDurationMs: 400 },
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
