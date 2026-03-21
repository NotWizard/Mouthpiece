import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const modulePath = path.resolve(process.cwd(), "src/tools/asrReplayHarness.mjs");

test("ASR replay harness produces a stable empty result when the fixture directory is missing", async () => {
  const mod = await import(modulePath);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mouthpiece-asr-replay-empty-"));
  const fixturesDir = path.join(tmpDir, "fixtures-does-not-exist");

  const result = await mod.runAsrReplay({
    fixturesDir,
    cwd: tmpDir,
    now: () => new Date("2026-03-21T09:00:00.000Z"),
  });

  assert.equal(result.schemaVersion, 1);
  assert.equal(result.runnerName, "mouthpiece-replay-scaffold");
  assert.equal(result.fixturesDir, fixturesDir);
  assert.equal(result.fixtureManifestFound, false);
  assert.deepEqual(result.totals, {
    cases: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
  });
  assert.deepEqual(result.results, []);
});

test("ASR replay harness loads manifest fixtures and marks them skipped until a processor is wired", async () => {
  const mod = await import(modulePath);

  const fixturesDir = await fs.mkdtemp(path.join(os.tmpdir(), "mouthpiece-asr-replay-fixtures-"));
  const manifestPath = path.join(fixturesDir, "manifest.json");

  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        fixtures: [
          {
            id: "quiet-zh-short",
            audioPath: "quiet-zh-short.wav",
            language: "zh-CN",
            expectedTranscript: "你好，世界",
            tags: ["quiet", "short"],
          },
        ],
      },
      null,
      2
    )
  );

  const result = await mod.runAsrReplay({
    fixturesDir,
    now: () => new Date("2026-03-21T09:05:00.000Z"),
  });

  assert.equal(result.fixtureManifestFound, true);
  assert.deepEqual(result.totals, {
    cases: 1,
    completed: 0,
    skipped: 1,
    failed: 0,
  });
  assert.equal(result.results[0].fixtureId, "quiet-zh-short");
  assert.equal(result.results[0].status, "skipped");
  assert.equal(result.results[0].skipReason, "no_fixture_processor");
  assert.equal(result.results[0].expectedTranscript, "你好，世界");
});

test("ASR replay harness writes JSON output when an output path is provided", async () => {
  const mod = await import(modulePath);

  const fixturesDir = await fs.mkdtemp(path.join(os.tmpdir(), "mouthpiece-asr-replay-output-"));
  const outputPath = path.join(fixturesDir, "results.json");

  const result = await mod.runAsrReplay({
    fixturesDir,
    outputPath,
    now: () => new Date("2026-03-21T09:10:00.000Z"),
  });

  const written = JSON.parse(await fs.readFile(outputPath, "utf8"));
  assert.deepEqual(written, result);
});
