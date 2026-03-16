const ONBOARDING_STEP_KEYS = Object.freeze(["welcome", "permissions", "activation"]);
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

export function normalizeOnboardingStep(step) {
  if (!Number.isFinite(step)) {
    return 0;
  }

  return Math.max(0, Math.min(step, getOnboardingMaxStep()));
}

export function shouldShowDictationPanelForOnboardingStep(step) {
  return normalizeOnboardingStep(step) >= ACTIVATION_STEP_INDEX;
}
