export const DEFAULT_ASR_FEATURE_FLAGS = Object.freeze({
  sessionTimeline: true,
  replayHarness: true,
  formalDictationState: true,
  unifiedSessionContract: false,
  multiStateVad: true,
  incrementalStabilizer: true,
});

const ENV_FLAG_NAMES = Object.freeze({
  sessionTimeline: "MOUTHPIECE_ASR_SESSION_TIMELINE",
  replayHarness: "MOUTHPIECE_ASR_REPLAY_HARNESS",
  formalDictationState: "MOUTHPIECE_ASR_FORMAL_DICTATION_STATE",
  unifiedSessionContract: "MOUTHPIECE_ASR_UNIFIED_SESSION_CONTRACT",
  multiStateVad: "MOUTHPIECE_ASR_MULTI_STATE_VAD",
  incrementalStabilizer: "MOUTHPIECE_ASR_INCREMENTAL_STABILIZER",
});

function normalizeBooleanFlag(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function resolveAsrFeatureFlags({ env = {}, overrides = {} } = {}) {
  const nextFlags = { ...DEFAULT_ASR_FEATURE_FLAGS };

  for (const [flagName, envName] of Object.entries(ENV_FLAG_NAMES)) {
    nextFlags[flagName] = normalizeBooleanFlag(env?.[envName], nextFlags[flagName]);
  }

  for (const [flagName, value] of Object.entries(overrides || {})) {
    if (!(flagName in nextFlags)) {
      continue;
    }
    nextFlags[flagName] = normalizeBooleanFlag(value, nextFlags[flagName]);
  }

  return Object.freeze(nextFlags);
}

export function isAsrFeatureEnabled(flagName, options) {
  const flags = resolveAsrFeatureFlags(options);
  return Boolean(flags[flagName]);
}
