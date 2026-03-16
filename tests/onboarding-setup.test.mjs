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

test("onboarding flow no longer includes a transcription setup step", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.getOnboardingStepKeys, "function");
  assert.deepEqual(mod.getOnboardingStepKeys(), ["welcome", "permissions", "activation"]);
});

test("onboarding activation stays on step index 2 after setup removal", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.getActivationStepIndex, "function");
  assert.equal(mod.getActivationStepIndex(), 2);
});

test("onboarding max step reflects the shorter three-step flow", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.getOnboardingMaxStep, "function");
  assert.equal(mod.getOnboardingMaxStep(), 2);
});

test("dictation panel becomes available on the activation step", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.shouldShowDictationPanelForOnboardingStep, "function");
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(0), false);
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(1), false);
  assert.equal(mod.shouldShowDictationPanelForOnboardingStep(2), true);
});

test("onboarding step normalization clamps invalid values to the new flow range", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.normalizeOnboardingStep, "function");
  assert.equal(mod.normalizeOnboardingStep(-1), 0);
  assert.equal(mod.normalizeOnboardingStep(Number.NaN), 0);
  assert.equal(mod.normalizeOnboardingStep(99), 2);
});
