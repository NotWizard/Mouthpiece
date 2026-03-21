import fs from "node:fs/promises";
import path from "node:path";
import { createAsrBenchmarkReport } from "../src/tools/asrBenchmarkReport.mjs";

function parseArgs(argv) {
  const options = {
    inputPath: "tmp/asr-replay.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input" && argv[index + 1]) {
      options.inputPath = argv[index + 1];
      index += 1;
    }
  }

  return options;
}

const { inputPath } = parseArgs(process.argv.slice(2));
const resolvedInputPath = path.resolve(process.cwd(), inputPath);

try {
  const raw = await fs.readFile(resolvedInputPath, "utf8");
  const replayResult = JSON.parse(raw);
  const report = createAsrBenchmarkReport(replayResult);

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (report.gateStatus === "failed") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
  process.exitCode = 1;
}
