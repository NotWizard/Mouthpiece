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
