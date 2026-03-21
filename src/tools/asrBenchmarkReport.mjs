function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function percentile(values, ratio) {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) {
    return sorted[0];
  }

  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * ratio));
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }

  const weight = position - lowerIndex;
  return Math.round(sorted[lowerIndex] + (sorted[upperIndex] - sorted[lowerIndex]) * weight);
}

function summarizeLatency(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      count: 0,
      min: null,
      p50: null,
      p95: null,
      max: null,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

function buildTotals(replayResult) {
  const fallback = {
    cases: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
  };

  if (!replayResult || typeof replayResult !== "object") {
    return fallback;
  }

  if (replayResult.totals && typeof replayResult.totals === "object") {
    return {
      cases: Number(replayResult.totals.cases) || 0,
      completed: Number(replayResult.totals.completed) || 0,
      skipped: Number(replayResult.totals.skipped) || 0,
      failed: Number(replayResult.totals.failed) || 0,
    };
  }

  const results = Array.isArray(replayResult.results) ? replayResult.results : [];
  return {
    cases: results.length,
    completed: results.filter((entry) => entry?.status === "completed").length,
    skipped: results.filter((entry) => entry?.status === "skipped").length,
    failed: results.filter((entry) => entry?.status === "failed").length,
  };
}

function collectSkipReasons(replayResult, totals) {
  const reasons = new Set();

  if (!replayResult?.fixtureManifestFound) {
    reasons.add("fixture manifest missing");
  }

  if (totals.cases === 0) {
    reasons.add("no replay fixtures available");
  }

  if (totals.completed === 0 && totals.skipped > 0 && reasons.size === 0) {
    reasons.add("all replay cases skipped");
  }

  return Array.from(reasons);
}

function collectOutcomeCounts(results) {
  const counts = {
    inserted: 0,
    replaced: 0,
    appended: 0,
    copied: 0,
    failed: 0,
    unknown: 0,
  };

  for (const result of results) {
    if (result?.status === "failed") {
      counts.failed += 1;
      continue;
    }

    const outcomeMode = result?.sessionSummary?.insertion?.outcomeMode;
    switch (outcomeMode) {
      case "inserted":
        counts.inserted += 1;
        break;
      case "replaced":
        counts.replaced += 1;
        break;
      case "appended":
        counts.appended += 1;
        break;
      case "copied":
        counts.copied += 1;
        break;
      case "failed":
        counts.failed += 1;
        break;
      default:
        if (result?.status === "completed") {
          counts.unknown += 1;
        }
        break;
    }
  }

  return counts;
}

function collectLatencyValues(results, metricKey) {
  return results
    .map((result) => toFiniteNumber(result?.sessionSummary?.metrics?.[metricKey]))
    .filter((value) => value !== null);
}

export function createAsrBenchmarkReport(replayResult) {
  const totals = buildTotals(replayResult);
  const results = Array.isArray(replayResult?.results) ? replayResult.results : [];
  const skipReasons = collectSkipReasons(replayResult, totals);
  const gateStatus = totals.failed > 0 ? "failed" : skipReasons.length > 0 ? "skipped" : "passed";

  return {
    schemaVersion: 1,
    runnerName: replayResult?.runnerName || "mouthpiece-replay-scaffold",
    generatedAt: replayResult?.generatedAt || new Date().toISOString(),
    fixturesDir: replayResult?.fixturesDir || null,
    fixtureManifestFound: Boolean(replayResult?.fixtureManifestFound),
    fixtureManifestPath: replayResult?.fixtureManifestPath || null,
    gateStatus,
    skipReasons,
    totals,
    outcomes: collectOutcomeCounts(results),
    latency: {
      firstPartial: summarizeLatency(collectLatencyValues(results, "firstPartialLatencyMs")),
      finalReady: summarizeLatency(collectLatencyValues(results, "finalReadyLatencyMs")),
      inserted: summarizeLatency(collectLatencyValues(results, "insertedLatencyMs")),
    },
  };
}
