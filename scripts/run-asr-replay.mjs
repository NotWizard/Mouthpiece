import { runAsrReplay } from "../src/tools/asrReplayHarness.mjs";

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--fixtures" && argv[index + 1]) {
      options.fixturesDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--output" && argv[index + 1]) {
      options.outputPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--runner-name" && argv[index + 1]) {
      options.runnerName = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

const options = parseArgs(process.argv.slice(2));

try {
  const result = await runAsrReplay(options);
  if (!options.outputPath) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
}
