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

  let state = { activeMs: 0, speechDetected: false };
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.011, frameMs: 80 });
  assert.deepEqual(state, { activeMs: 80, speechDetected: false });

  state = mod.advanceStreamingSpeechGate(state, { rms: 0.012, frameMs: 80 });
  assert.deepEqual(state, { activeMs: 160, speechDetected: true });
});

test("streaming speech gate resets if voice activity drops before the gate fully opens", async () => {
  const mod = await loadGateModule();

  let state = { activeMs: 0, speechDetected: false };
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.011, frameMs: 80 });
  state = mod.advanceStreamingSpeechGate(state, { rms: 0.002, frameMs: 80 });

  assert.deepEqual(state, { activeMs: 0, speechDetected: false });
});

test("streaming silence discard only drops transcripts when speech was never detected", async () => {
  const mod = await loadGateModule();

  assert.equal(
    mod.shouldDiscardStreamingTranscript({
      speechDetected: false,
      peakRms: 0.006,
    }),
    true
  );

  assert.equal(
    mod.shouldDiscardStreamingTranscript({
      speechDetected: true,
      peakRms: 0.006,
    }),
    false
  );

  assert.equal(
    mod.shouldDiscardStreamingTranscript({
      speechDetected: false,
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
  assert.match(source, /this\.streamingHeldPartialText = "";/);
  assert.match(
    source,
    /if \(!this\.streamingSpeechDetected\) \{\s*this\.streamingHeldPartialText = cleanedText;\s*return;\s*\}/s
  );
  assert.match(
    source,
    /if \(shouldDiscardStreamingTranscript\(\{\s*speechDetected: this\.streamingSpeechDetected,\s*peakRms: this\._peakRms,\s*\}\)\) \{\s*finalText = "";/s
  );
});
