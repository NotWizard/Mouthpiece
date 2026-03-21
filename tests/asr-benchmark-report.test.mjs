import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const modulePath = path.resolve(process.cwd(), "src/tools/asrBenchmarkReport.mjs");

test("ASR benchmark report skips cleanly when no fixture corpus is available", async () => {
  const mod = await import(modulePath);

  const report = mod.createAsrBenchmarkReport({
    schemaVersion: 1,
    runnerName: "mouthpiece-replay-scaffold",
    generatedAt: "2026-03-21T12:00:00.000Z",
    fixturesDir: "/tmp/fixtures/asr",
    fixtureManifestFound: false,
    fixtureManifestPath: "/tmp/fixtures/asr/manifest.json",
    totals: {
      cases: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    },
    results: [],
  });

  assert.equal(report.gateStatus, "skipped");
  assert.match(report.skipReasons[0], /fixture/i);
  assert.equal(report.totals.cases, 0);
  assert.equal(report.outcomes.inserted, 0);
});

test("ASR benchmark report summarizes replay totals and insertion outcomes", async () => {
  const mod = await import(modulePath);

  const report = mod.createAsrBenchmarkReport({
    schemaVersion: 1,
    runnerName: "mouthpiece-replay-scaffold",
    generatedAt: "2026-03-21T12:00:00.000Z",
    fixturesDir: "/tmp/fixtures/asr",
    fixtureManifestFound: true,
    fixtureManifestPath: "/tmp/fixtures/asr/manifest.json",
    totals: {
      cases: 3,
      completed: 2,
      skipped: 1,
      failed: 0,
    },
    results: [
      {
        fixtureId: "a",
        status: "completed",
        sessionSummary: {
          status: "inserted",
          metrics: {
            firstPartialLatencyMs: 110,
            finalReadyLatencyMs: 420,
            insertedLatencyMs: 510,
          },
          insertion: {
            outcomeMode: "inserted",
          },
        },
      },
      {
        fixtureId: "b",
        status: "completed",
        sessionSummary: {
          status: "inserted",
          metrics: {
            firstPartialLatencyMs: 150,
            finalReadyLatencyMs: 480,
            insertedLatencyMs: 640,
          },
          insertion: {
            outcomeMode: "replaced",
          },
        },
      },
      {
        fixtureId: "c",
        status: "skipped",
        skipReason: "no_fixture_processor",
      },
    ],
  });

  assert.equal(report.gateStatus, "passed");
  assert.equal(report.totals.completed, 2);
  assert.equal(report.outcomes.inserted, 1);
  assert.equal(report.outcomes.replaced, 1);
  assert.equal(report.outcomes.copied, 0);
  assert.equal(report.latency.firstPartial.p50, 130);
  assert.equal(report.latency.finalReady.p50, 450);
  assert.equal(report.latency.inserted.p50, 575);
});
