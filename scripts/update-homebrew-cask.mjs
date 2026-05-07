import fs from "node:fs/promises";
import {
  getHomebrewCaskReleaseInfo,
  renderHomebrewCask,
} from "./lib/release-update-metadata.mjs";

function getArgValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) {
    return null;
  }

  return process.argv[flagIndex + 1] || null;
}

async function main() {
  const releaseJsonPath = getArgValue("--release-json");
  const outputPath = getArgValue("--output");
  const version = getArgValue("--version");

  if (!releaseJsonPath || !outputPath || !version) {
    throw new Error(
      "Usage: node scripts/update-homebrew-cask.mjs --release-json <file> --version <version> --output <file>"
    );
  }

  const releaseJsonText = await fs.readFile(releaseJsonPath, "utf8");
  const releaseInfo = getHomebrewCaskReleaseInfo({ releaseJsonText, version });

  await fs.writeFile(outputPath, renderHomebrewCask(releaseInfo), "utf8");
  console.log(`Generated Homebrew cask for Mouthpiece ${releaseInfo.version}.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
