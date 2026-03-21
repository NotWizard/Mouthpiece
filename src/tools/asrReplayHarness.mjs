import fs from "node:fs/promises";
import path from "node:path";

export const ASR_REPLAY_SCHEMA_VERSION = 1;
export const DEFAULT_REPLAY_MANIFEST_NAME = "manifest.json";
export const DEFAULT_REPLAY_RUNNER_NAME = "mouthpiece-replay-scaffold";

function normalizeDate(now) {
  if (typeof now === "function") {
    return normalizeDate(now());
  }
  if (now instanceof Date) {
    return now;
  }
  if (typeof now === "string" || typeof now === "number") {
    const date = new Date(now);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

function normalizeFixtureEntry(entry, fixturesDir) {
  return {
    fixtureId: entry.id,
    audioPath: path.resolve(fixturesDir, entry.audioPath),
    relativeAudioPath: entry.audioPath,
    language: entry.language || "auto",
    expectedTranscript: entry.expectedTranscript || "",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
  };
}

function buildTotals(results) {
  return {
    cases: results.length,
    completed: results.filter((result) => result.status === "completed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed: results.filter((result) => result.status === "failed").length,
  };
}

export async function loadReplayFixtureManifest(fixturesDir) {
  const manifestPath = path.join(fixturesDir, DEFAULT_REPLAY_MANIFEST_NAME);

  try {
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    const fixtures = Array.isArray(parsed?.fixtures) ? parsed.fixtures : [];

    return {
      fixtureManifestFound: true,
      fixtureManifestPath: manifestPath,
      manifest: {
        schemaVersion: parsed?.schemaVersion || ASR_REPLAY_SCHEMA_VERSION,
        fixtures,
      },
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        fixtureManifestFound: false,
        fixtureManifestPath: manifestPath,
        manifest: {
          schemaVersion: ASR_REPLAY_SCHEMA_VERSION,
          fixtures: [],
        },
      };
    }

    throw error;
  }
}

export async function runAsrReplay({
  fixturesDir = path.resolve(process.cwd(), "fixtures/asr"),
  cwd = process.cwd(),
  outputPath = null,
  runnerName = DEFAULT_REPLAY_RUNNER_NAME,
  now = () => new Date(),
  processFixture = null,
} = {}) {
  const resolvedFixturesDir = path.resolve(cwd, fixturesDir);
  const { fixtureManifestFound, fixtureManifestPath, manifest } =
    await loadReplayFixtureManifest(resolvedFixturesDir);

  const normalizedFixtures = manifest.fixtures.map((entry) =>
    normalizeFixtureEntry(entry, resolvedFixturesDir)
  );

  const results = [];

  for (const fixture of normalizedFixtures) {
    if (typeof processFixture !== "function") {
      results.push({
        fixtureId: fixture.fixtureId,
        audioPath: fixture.audioPath,
        relativeAudioPath: fixture.relativeAudioPath,
        language: fixture.language,
        expectedTranscript: fixture.expectedTranscript,
        tags: fixture.tags,
        status: "skipped",
        skipReason: "no_fixture_processor",
      });
      continue;
    }

    try {
      const outcome = await processFixture(fixture);
      results.push({
        fixtureId: fixture.fixtureId,
        audioPath: fixture.audioPath,
        relativeAudioPath: fixture.relativeAudioPath,
        language: fixture.language,
        expectedTranscript: fixture.expectedTranscript,
        tags: fixture.tags,
        ...outcome,
        status: outcome?.status || "completed",
      });
    } catch (error) {
      results.push({
        fixtureId: fixture.fixtureId,
        audioPath: fixture.audioPath,
        relativeAudioPath: fixture.relativeAudioPath,
        language: fixture.language,
        expectedTranscript: fixture.expectedTranscript,
        tags: fixture.tags,
        status: "failed",
        error: error?.message || String(error),
      });
    }
  }

  const result = {
    schemaVersion: ASR_REPLAY_SCHEMA_VERSION,
    runnerName,
    generatedAt: normalizeDate(now).toISOString(),
    fixturesDir: resolvedFixturesDir,
    fixtureManifestFound,
    fixtureManifestPath,
    totals: buildTotals(results),
    results,
  };

  if (outputPath) {
    const resolvedOutputPath = path.resolve(cwd, outputPath);
    await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
    await fs.writeFile(resolvedOutputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  return result;
}
