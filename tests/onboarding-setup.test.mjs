import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadOnboardingFlowModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/onboardingFlow.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("onboarding flow includes the dedicated hotkey setup step before activation", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.getOnboardingStepKeys, "function");
  assert.deepEqual(mod.getOnboardingStepKeys(), [
    "welcome",
    "permissions",
    "hotkeySetup",
    "activation",
  ]);
});

test("onboarding activation moves to step index 3 after the hotkey setup step is added", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.getActivationStepIndex, "function");
  assert.equal(mod.getActivationStepIndex(), 3);
});

test("onboarding max step reflects the new four-step flow", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.getOnboardingMaxStep, "function");
  assert.equal(mod.getOnboardingMaxStep(), 3);
});

test("dictation panel becomes available only once activation begins", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.shouldShowDictationPanelForOnboardingStep, "function");
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(0), false);
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(1), false);
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(2), false);
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(3), true);
});

test("onboarding step normalization clamps invalid values to the four-step range", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.normalizeOnboardingStep, "function");
  assert.equal(mod.normalizeOnboardingStep(-1), 0);
  assert.equal(mod.normalizeOnboardingStep(Number.NaN), 0);
  assert.equal(mod.normalizeOnboardingStep(99), 3);
});
