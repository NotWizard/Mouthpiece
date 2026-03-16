import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadWaveformModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/dictationWaveform.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("normalizeAudioLevel clamps raw mic energy into a usable animation range", async () => {
  const mod = await loadWaveformModule();

  assert.equal(typeof mod.normalizeAudioLevel, "function");
  assert.equal(mod.normalizeAudioLevel(-1), 0);
  assert.equal(mod.normalizeAudioLevel(0), 0);
  assert.ok(mod.normalizeAudioLevel(0.06) > mod.normalizeAudioLevel(0.01));
  assert.equal(mod.normalizeAudioLevel(10), 1);
});

test("getWaveformActivityLevel suppresses room tone until real speech is detected", async () => {
  const mod = await loadWaveformModule();

  assert.equal(typeof mod.getWaveformActivityLevel, "function");
  assert.equal(mod.getWaveformActivityLevel(0), 0);
  assert.equal(mod.getWaveformActivityLevel(0.04), 0);
  assert.equal(mod.getWaveformActivityLevel(0.07), 0);
  assert.ok(mod.getWaveformActivityLevel(0.18) > 0);
  assert.equal(mod.getWaveformActivityLevel(1), 1);
});

test("buildWaveformDots produces a denser waveform when the input level rises", async () => {
  const mod = await loadWaveformModule();

  assert.equal(typeof mod.buildWaveformDots, "function");

  const quiet = mod.buildWaveformDots({ count: 28, level: 0.08, phase: 0.2, active: true });
  const loud = mod.buildWaveformDots({ count: 28, level: 0.85, phase: 0.2, active: true });

  assert.equal(quiet.length, 28);
  assert.equal(loud.length, 28);
  assert.ok(loud.some((value) => value > 0.82));
  assert.ok(
    loud.reduce((sum, value) => sum + value, 0) > quiet.reduce((sum, value) => sum + value, 0)
  );
  assert.ok(quiet.every((value) => value >= 0 && value <= 1));
  assert.ok(loud.every((value) => value >= 0 && value <= 1));
});

test("buildWaveformDots follows provided sample history during recording", async () => {
  const mod = await loadWaveformModule();

  assert.equal(typeof mod.buildWaveformDots, "function");

  const silent = mod.buildWaveformDots({
    count: 12,
    samples: Array(12).fill(0),
    active: true,
  });
  const loud = mod.buildWaveformDots({
    count: 12,
    samples: Array(12).fill(1),
    active: true,
  });

  assert.equal(silent.length, 12);
  assert.equal(loud.length, 12);
  assert.notDeepEqual(loud, silent);
  assert.ok(silent.every((value) => value <= 0.045));
  assert.ok(
    loud.reduce((sum, value) => sum + value, 0) > silent.reduce((sum, value) => sum + value, 0)
  );
  assert.ok(silent.every((value) => value >= 0 && value <= 1));
  assert.ok(loud.every((value) => value >= 0 && value <= 1));
});

test("buildWaveformDots stays flat for near-silent room tone", async () => {
  const mod = await loadWaveformModule();

  const roomTone = [0.01, 0.04, 0.02, 0.06, 0.03, 0.01, 0.04, 0.02, 0.07, 0.03, 0.01, 0.04];
  const dots = mod.buildWaveformDots({
    count: 12,
    samples: roomTone,
    active: true,
  });

  assert.equal(dots.length, 12);
  assert.ok(dots.every((value) => value >= 0 && value <= 1));
  assert.ok(dots.every((value) => Math.abs(value - dots[0]) < 1e-9));
});

test("buildWaveformDots turns steady speech energy into a coordinated wave", async () => {
  const mod = await loadWaveformModule();

  const quiet = mod.buildWaveformDots({
    count: 16,
    samples: Array(16).fill(0.22),
    active: true,
    phase: 0.15,
  });
  const loud = mod.buildWaveformDots({
    count: 16,
    samples: Array(16).fill(0.78),
    active: true,
    phase: 0.15,
  });

  const quietRange = Math.max(...quiet) - Math.min(...quiet);
  const loudRange = Math.max(...loud) - Math.min(...loud);

  assert.ok(quietRange > 0.005);
  assert.ok(loudRange > quietRange);
  assert.ok(quietRange < 0.08);
  assert.ok(loudRange < 0.2);
});

test("buildWaveformDots carries fresh audio from right to left over time", async () => {
  const mod = await loadWaveformModule();

  const entering = mod.buildWaveformDots({
    count: 8,
    samples: [0, 0, 0, 0, 0, 0, 0, 0.72],
    active: true,
  });
  const shifted = mod.buildWaveformDots({
    count: 8,
    samples: [0, 0, 0, 0, 0, 0, 0.72, 0],
    active: true,
  });

  assert.ok(entering[7] > entering[6]);
  assert.ok(shifted[6] > shifted[7]);
  assert.ok(Math.max(...shifted.slice(0, 6)) <= shifted[6]);
});

test("buildWaveformDots gives normal speaking levels a visible waveform range", async () => {
  const mod = await loadWaveformModule();

  const typicalSpeech = [
    0.092, 0.099, 0.079, 0.211, 0.091, 0.207, 0.176, 0.099, 0.209, 0.08, 0.18, 0.1, 0.09, 0.104,
    0.113, 0.1,
  ];
  const dots = mod.buildWaveformDots({
    count: 16,
    samples: typicalSpeech,
    active: true,
    phase: 1.5,
  });

  const range = Math.max(...dots) - Math.min(...dots);

  assert.ok(range > 0.05);
  assert.ok(Math.max(...dots) > 0.15);
});
