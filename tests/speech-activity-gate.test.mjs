import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadGateModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/speechActivityGate.mjs")
  ).href;
  return import(modulePath);
}

function frame(rms, sampleCount = 800) {
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = index % 2 === 0 ? rms : -rms;
  }
  return samples;
}

test("speech activity gate rejects sustained low-SNR background noise", async () => {
  const mod = await loadGateModule();
  let state = mod.createSpeechActivityGateState();
  const config = mod.getSpeechActivityGateConfig({
    audioQualityMode: "noise_reduction",
    voiceGateStrictness: "strict",
  });

  for (let index = 0; index < 14; index += 1) {
    const result = mod.advanceSpeechActivityGate(state, frame(0.014), config);
    state = result.state;
  }

  assert.equal(state.gateState, "idle");
  assert.equal(state.speechDetected, false);
  assert.equal(state.noiseFloor > 0.006, true);
});

test("speech activity gate opens for sustained near-field speech with pre-roll", async () => {
  const mod = await loadGateModule();
  let state = mod.createSpeechActivityGateState();
  const config = mod.getSpeechActivityGateConfig({
    audioQualityMode: "noise_reduction",
    voiceGateStrictness: "standard",
  });
  const sent = [];

  for (let index = 0; index < 6; index += 1) {
    const result = mod.advanceSpeechActivityGate(state, frame(0.004), config);
    state = result.state;
  }

  for (let index = 0; index < 8; index += 1) {
    const result = mod.advanceSpeechActivityGate(state, frame(0.052), config);
    state = result.state;
    sent.push(...result.framesToSend);
  }

  assert.equal(state.speechDetected, true);
  assert.equal(state.gateState, "speaking");
  assert.equal(sent.length >= 6, true);
  assert.equal(sent[0].samples instanceof Float32Array, true);
});

test("speech activity gate keeps hangover frames and then closes", async () => {
  const mod = await loadGateModule();
  let state = mod.createSpeechActivityGateState();
  const config = mod.getSpeechActivityGateConfig({
    audioQualityMode: "balanced",
    voiceGateStrictness: "standard",
  });

  for (let index = 0; index < 5; index += 1) {
    state = mod.advanceSpeechActivityGate(state, frame(0.05), config).state;
  }
  assert.equal(state.gateState, "speaking");

  let hangoverSawSend = false;
  for (let index = 0; index < 3; index += 1) {
    const result = mod.advanceSpeechActivityGate(state, frame(0.002), config);
    state = result.state;
    hangoverSawSend = hangoverSawSend || result.framesToSend.length > 0;
  }
  assert.equal(hangoverSawSend, true);

  for (let index = 0; index < 6; index += 1) {
    state = mod.advanceSpeechActivityGate(state, frame(0.002), config).state;
  }

  assert.equal(state.gateState, "idle");
  assert.equal(state.speechDetected, false);
});

test("speech activity gate reopens for softer speech after a pause", async () => {
  const mod = await loadGateModule();
  let state = mod.createSpeechActivityGateState();
  const config = mod.getSpeechActivityGateConfig({
    audioQualityMode: "noise_reduction",
    voiceGateStrictness: "standard",
  });
  let firstUtteranceSent = 0;
  let secondUtteranceSent = 0;

  for (let index = 0; index < 8; index += 1) {
    state = mod.advanceSpeechActivityGate(state, frame(0.004), config).state;
  }

  for (let index = 0; index < 160; index += 1) {
    const result = mod.advanceSpeechActivityGate(state, frame(0.052), config);
    state = result.state;
    firstUtteranceSent += result.framesToSend.length;
  }

  for (let index = 0; index < 20; index += 1) {
    state = mod.advanceSpeechActivityGate(state, frame(0.004), config).state;
  }

  for (let index = 0; index < 30; index += 1) {
    const result = mod.advanceSpeechActivityGate(state, frame(0.04), config);
    state = result.state;
    secondUtteranceSent += result.framesToSend.length;
  }

  assert.equal(firstUtteranceSent >= 150, true);
  assert.equal(secondUtteranceSent >= 20, true);
});

test("analyzeSpeechActivity rejects noisy clips and keeps speech clips", async () => {
  const mod = await loadGateModule();
  const config = mod.getSpeechActivityGateConfig({
    audioQualityMode: "noise_reduction",
    voiceGateStrictness: "strict",
  });

  const noiseSamples = new Float32Array(16000)
    .fill(0)
    .map((_, index) => (index % 2 ? 0.012 : -0.012));
  const speechSamples = new Float32Array(16000).fill(0).map((_, index) => {
    if (index < 3200 || index > 12800) return index % 2 ? 0.003 : -0.003;
    return index % 2 ? 0.06 : -0.06;
  });

  const noise = mod.analyzeSpeechActivity(noiseSamples, config);
  const speech = mod.analyzeSpeechActivity(speechSamples, config);

  assert.equal(noise.shouldTranscribe, false);
  assert.equal(speech.shouldTranscribe, true);
  assert.equal(speech.trimStartSample > 0, true);
  assert.equal(speech.trimEndSample < speechSamples.length, true);
});
