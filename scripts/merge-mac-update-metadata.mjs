import fs from "node:fs/promises";
import path from "node:path";
import { mergeMacUpdateMetadata } from "./lib/release-update-metadata.mjs";

function getArgValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) {
    return null;
  }

  return process.argv[flagIndex + 1] || null;
}

async function main() {
  const x64Path = getArgValue("--x64");
  const arm64Path = getArgValue("--arm64");
  const outputPath = getArgValue("--output");

  if (!x64Path || !arm64Path || !outputPath) {
    throw new Error("Usage: node scripts/merge-mac-update-metadata.mjs --x64 <file> --arm64 <file> --output <file>");
  }

  const [x64Yaml, arm64Yaml] = await Promise.all([
    fs.readFile(x64Path, "utf8"),
    fs.readFile(arm64Path, "utf8"),
  ]);

  const mergedYaml = mergeMacUpdateMetadata({ x64Yaml, arm64Yaml });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, mergedYaml, "utf8");

  console.log(`Merged mac update metadata written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
