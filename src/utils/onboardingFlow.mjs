const ONBOARDING_STEP_KEYS = Object.freeze(["welcome", "permissions", "hotkeySetup", "activation"]);
const HOTKEY_SETUP_STEP_INDEX = ONBOARDING_STEP_KEYS.indexOf("hotkeySetup");
const ACTIVATION_STEP_INDEX = ONBOARDING_STEP_KEYS.indexOf("activation");

export function getOnboardingStepKeys() {
  return [...ONBOARDING_STEP_KEYS];
}

export function getOnboardingMaxStep() {
  return ONBOARDING_STEP_KEYS.length - 1;
}

export function getActivationStepIndex() {
  return ACTIVATION_STEP_INDEX;
}

export function getHotkeySetupStepIndex() {
  return HOTKEY_SETUP_STEP_INDEX;
}

export function normalizeOnboardingStep(step) {
  if (!Number.isFinite(step)) {
    return 0;
  }

  return Math.max(0, Math.min(step, getOnboardingMaxStep()));
}

export function shouldShowDictationPanelForOnboardingStep(step) {
  return normalizeOnboardingStep(step) >= ACTIVATION_STEP_INDEX;
}

function normalizeHotkeyValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function resolveOnboardingHotkeyDraft({
  draftHotkey = "",
  settingsHotkey = "",
  hasUserEdited = false,
  fallbackHotkey = "",
} = {}) {
  const normalizedDraftHotkey = normalizeHotkeyValue(draftHotkey);
  const normalizedSettingsHotkey = normalizeHotkeyValue(settingsHotkey);
  const normalizedFallbackHotkey = normalizeHotkeyValue(fallbackHotkey);

  if (!hasUserEdited && normalizedSettingsHotkey) {
    return normalizedSettingsHotkey;
  }

  return normalizedDraftHotkey || normalizedSettingsHotkey || normalizedFallbackHotkey;
}
