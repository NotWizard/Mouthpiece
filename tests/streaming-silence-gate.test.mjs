import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadGateModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/streamingSpeechGate.mjs")
  ).href;
  return import(modulePath);
}

test("streaming speech gate waits for sustained voice activity before opening", async () => {
  const mod = await loadGateModule();

  assert.equal(typeof mod.advanceStreamingSpeechGate, "function");
  assert.equal(mod.STREAMING_SILENCE_THRESHOLD, 0.01);
  assert.equal(mod.STREAMING_SPEECH_GATE_MIN_ACTIVE_MS, 160);
  assert.equal(mod.STREAMING_SPEECH_GATE_HANGOVER_MS, 240);

  let state = mod.createStreamingSpeechGateState();
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.011, frameMs: 80 });
  assert.equal(state.stage, "pre_speech");
  assert.equal(state.activeMs, 80);
  assert.equal(state.speechDetected, false);

  state = mod.advanceStreamingSpeechGate(state, { rms: 0.012, frameMs: 80 });
  assert.equal(state.stage, "speaking");
  assert.equal(state.activeMs, 160);
  assert.equal(state.speechDetected, true);
});

test("streaming speech gate resets if voice activity drops before the gate fully opens", async () => {
  const mod = await loadGateModule();

  let state = mod.createStreamingSpeechGateState();
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.011, frameMs: 80 });
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.002, frameMs: 80 });

  assert.equal(state.stage, "idle");
  assert.equal(state.activeMs, 0);
  assert.equal(state.speechDetected, false);
});

test("streaming speech gate still opens for steady low-volume speech near the threshold", async () => {
  const mod = await loadGateModule();

  let state = mod.createStreamingSpeechGateState();
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.012, frameMs: 80 });
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.012, frameMs: 80 });

  assert.equal(state.stage, "speaking");
  assert.equal(state.speechDetected, true);
});

test("streaming speech gate keeps a short hangover before closing on silence", async () => {
  const mod = await loadGateModule();

  let state = mod.createStreamingSpeechGateState();
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.014, frameMs: 80 });
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.015, frameMs: 80 });
  assert.equal(state.stage, "speaking");

  state = mod.advanceStreamingSpeechGate(state, { rms: 0.003, frameMs: 80 });
  assert.equal(state.stage, "hangover");
  assert.equal(state.speechDetected, true);

  state = mod.advanceStreamingSpeechGate(state, { rms: 0.003, frameMs: 80 });
  assert.equal(state.stage, "hangover");
  assert.equal(state.speechDetected, true);

  state = mod.advanceStreamingSpeechGate(state, { rms: 0.003, frameMs: 80 });
  assert.equal(state.stage, "idle");
  assert.equal(state.speechDetected, false);
});

test("streaming speech gate adapts its noise floor before requiring a stronger speech delta", async () => {
  const mod = await loadGateModule();

  let state = mod.createStreamingSpeechGateState();
  for (let index = 0; index < 6; index += 1) {
    state = mod.advanceStreamingSpeechGate(state, {
      rms: 0.014,
      frameMs: 80,
    });
  }

  assert.equal(state.stage, "idle");
  assert.equal(state.speechDetected, false);
  assert.equal(state.noiseFloor > 0.004, true);
  assert.equal(state.threshold > mod.STREAMING_SILENCE_THRESHOLD, true);

  state = mod.advanceStreamingSpeechGate(state, {
    rms: 0.015,
    frameMs: 80,
  });
  assert.equal(state.stage, "idle");
  assert.equal(state.speechDetected, false);

  state = mod.advanceStreamingSpeechGate(state, {
    rms: 0.028,
    frameMs: 80,
  });
  state = mod.advanceStreamingSpeechGate(state, {
    rms: 0.029,
    frameMs: 80,
  });
  assert.equal(state.stage, "speaking");
  assert.equal(state.speechDetected, true);
});

test("streaming silence discard only drops transcripts when speech was never detected", async () => {
  const mod = await loadGateModule();

  assert.equal(
    mod.shouldDiscardStreamingTranscript({
      speechDetectedEver: false,
      peakRms: 0.006,
    }),
    true
  );

  assert.equal(
    mod.shouldDiscardStreamingTranscript({
      speechDetectedEver: true,
      peakRms: 0.006,
    }),
    false
  );

  assert.equal(
    mod.shouldDiscardStreamingTranscript({
      speechDetectedEver: false,
      peakRms: 0.021,
    }),
    false
  );
});

test("audio manager gates Bailian realtime partials until speech is detected and discards silent transcripts at stop", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/audioManager.js"),
    "utf8"
  );

  assert.match(source, /advanceStreamingSpeechGate/);
  assert.match(source, /shouldDiscardStreamingTranscript/);
  assert.match(source, /this\.streamingSpeechDetected = false;/);
  assert.match(source, /this\.streamingSpeechEverDetected = false;/);
  assert.match(source, /this\.streamingHeldPartialText = null;/);
  assert.match(source, /onSpeechStarted: \(cb\) => window\.electronAPI\.onBailianRealtimeSpeechStarted\(cb\)/);
  assert.match(source, /promoteStreamingSpeechGateFromProvider\(/);
  assert.match(
    source,
    /const speechStartedCleanup = provider\.onSpeechStarted\?\.\(\(\) => \{\s*this\.promoteStreamingSpeechGateFromProvider\(\);\s*\}\);/s
  );
  assert.match(
    source,
    /if\s*\(\s*!this\.streamingSpeechGateState\.speechDetected\s*\)\s*\{\s*this\.streamingHeldPartialText = isStructuredBailianPayload \? partialPayload : cleanedText;\s*return;\s*\}/s
  );
  assert.match(
    source,
    /if\s*\(\s*shouldDiscardStreamingTranscript\(\{\s*speechDetectedEver:\s*this\.streamingSpeechEverDetected,\s*peakRms:\s*this\._peakRms,\s*\}\s*\)\s*\)\s*\{\s*finalText = "";/s
  );
});
