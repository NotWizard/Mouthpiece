function normalizePersistedHotkey(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getDefaultHotkeyForPlatform(platform = process.platform) {
  return platform === "darwin" ? "GLOBE" : "Control+Super";
}

function resolvePersistedHotkey({
  envHotkey = "",
  rendererDictationKey = "",
  rendererLegacyHotkey = "",
  platform = process.platform,
} = {}) {
  const normalizedEnvHotkey = normalizePersistedHotkey(envHotkey);
  const normalizedRendererDictationKey = normalizePersistedHotkey(rendererDictationKey);
  const normalizedRendererLegacyHotkey = normalizePersistedHotkey(rendererLegacyHotkey);

  if (normalizedEnvHotkey) {
    return {
      hotkey: normalizedEnvHotkey,
      source: "env",
      needsEnvSync: false,
      needsRendererSync: normalizedRendererDictationKey !== normalizedEnvHotkey,
      needsLegacyCleanup: Boolean(normalizedRendererLegacyHotkey),
    };
  }

  if (normalizedRendererDictationKey) {
    return {
      hotkey: normalizedRendererDictationKey,
      source: "renderer",
      needsEnvSync: true,
      needsRendererSync: false,
      needsLegacyCleanup: Boolean(normalizedRendererLegacyHotkey),
    };
  }

  if (normalizedRendererLegacyHotkey) {
    return {
      hotkey: normalizedRendererLegacyHotkey,
      source: "legacy-renderer",
      needsEnvSync: true,
      needsRendererSync: true,
      needsLegacyCleanup: true,
    };
  }

  return {
    hotkey: getDefaultHotkeyForPlatform(platform),
    source: "default",
    needsEnvSync: false,
    needsRendererSync: false,
    needsLegacyCleanup: false,
  };
}

module.exports = {
  normalizePersistedHotkey,
  getDefaultHotkeyForPlatform,
  resolvePersistedHotkey,
};
