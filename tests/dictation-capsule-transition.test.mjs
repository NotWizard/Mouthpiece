import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadTransitionModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/dictationCapsuleTransition.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("dictation capsule morph keeps the recording shell larger before settling into the compact transcribing shell", async () => {
  const mod = await loadTransitionModule();

  assert.equal(typeof mod.getDictationCapsuleLayout, "function");

  const recording = mod.getDictationCapsuleLayout({ stage: "recording" });
  const transcribing = mod.getDictationCapsuleLayout({ stage: "transcribing" });

  assert.ok(recording.widthPx > transcribing.widthPx);
  assert.ok(recording.heightPx > transcribing.heightPx);
  assert.ok(recording.borderRadiusPx > transcribing.borderRadiusPx);
});

test("dictation capsule uses a neutral collapsing phase instead of overlapping recording and transcribing content", async () => {
  const mod = await loadTransitionModule();

  assert.equal(typeof mod.getDictationCapsuleVisualState, "function");
  assert.equal(typeof mod.DICTATION_CAPSULE_MORPH_DURATION_MS, "number");
  assert.equal(typeof mod.DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS, "number");

  const recording = mod.getDictationCapsuleVisualState({
    isTranscribing: false,
    elapsedMs: 999,
  });
  const collapsing = mod.getDictationCapsuleVisualState({
    isTranscribing: true,
    elapsedMs: mod.DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS - 1,
  });
  const transcribing = mod.getDictationCapsuleVisualState({
    isTranscribing: true,
    elapsedMs: mod.DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS,
  });

  assert.deepEqual(recording, {
    stage: "recording",
    showRecordingContent: true,
    showMorphIndicator: false,
    showCompactContent: false,
  });
  assert.deepEqual(collapsing, {
    stage: "collapsing",
    showRecordingContent: false,
    showMorphIndicator: true,
    showCompactContent: false,
  });
  assert.deepEqual(transcribing, {
    stage: "transcribing",
    showRecordingContent: false,
    showMorphIndicator: false,
    showCompactContent: true,
  });
});

test("dictation capsule waits to show compact transcribing content until after the shell has started shrinking", async () => {
  const mod = await loadTransitionModule();

  assert.equal(typeof mod.getDictationCapsuleVisualState, "function");

  const collapsing = mod.getDictationCapsuleVisualState({
    isTranscribing: true,
    elapsedMs: 0,
  });
  const transcribing = mod.getDictationCapsuleVisualState({
    isTranscribing: true,
    elapsedMs: mod.DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS,
  });

  assert.equal(collapsing.stage, "collapsing");
  assert.equal(collapsing.showCompactContent, false);
  assert.equal(transcribing.stage, "transcribing");
  assert.equal(transcribing.showCompactContent, true);
  assert.ok(mod.DICTATION_CAPSULE_MORPH_DURATION_MS > mod.DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS);
  assert.ok(mod.DICTATION_CAPSULE_CONTENT_SWAP_DELAY_MS > 0);
});

test("dictation capsule resolves compact shell layout during the collapsing bridge state", async () => {
  const mod = await loadTransitionModule();

  assert.equal(typeof mod.getDictationCapsuleLayout, "function");

  const collapsing = mod.getDictationCapsuleLayout({
    stage: "collapsing",
  });
  const transcribing = mod.getDictationCapsuleLayout({
    stage: "transcribing",
  });

  assert.deepEqual(collapsing, transcribing);
  assert.deepEqual(
    mod.getDictationCapsuleVisualState({
      isTranscribing: true,
      elapsedMs: 0,
    }),
    {
      stage: "collapsing",
      showRecordingContent: false,
      showMorphIndicator: true,
      showCompactContent: false,
    }
  );
});
