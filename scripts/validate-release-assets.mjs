import fs from "node:fs/promises";
import {
  getAssetNamesFromReleaseJson,
  validateReleaseAssets,
} from "./lib/release-update-metadata.mjs";

function getArgValue(flagName) {
  const flagIndex = process.argv.indexOf(flagName);
  if (flagIndex === -1) {
    return null;
  }

  return process.argv[flagIndex + 1] || null;
}

async function readOptionalFile(filePath) {
  if (!filePath) {
    return "";
  }

  return fs.readFile(filePath, "utf8");
}

async function main() {
  const releaseJsonPath = getArgValue("--release-json");

  if (!releaseJsonPath) {
    throw new Error("Usage: node scripts/validate-release-assets.mjs --release-json <file> [--latest-windows <file>] [--latest-linux <file>] [--latest-mac <file>] [--latest-arm64 <file>] [--latest-x64 <file>]");
  }

  const [
    releaseJsonText,
    latestWindowsYaml,
    latestLinuxYaml,
    latestMacYaml,
    latestArm64Yaml,
    latestX64Yaml,
  ] = await Promise.all([
    fs.readFile(releaseJsonPath, "utf8"),
    readOptionalFile(getArgValue("--latest-windows")),
    readOptionalFile(getArgValue("--latest-linux")),
    readOptionalFile(getArgValue("--latest-mac")),
    readOptionalFile(getArgValue("--latest-arm64")),
    readOptionalFile(getArgValue("--latest-x64")),
  ]);

  validateReleaseAssets({
    assetNames: getAssetNamesFromReleaseJson(releaseJsonText),
    latestWindowsYaml,
    latestLinuxYaml,
    latestMacYaml,
    latestArm64Yaml,
    latestX64Yaml,
  });

  console.log("Release assets validated successfully.");
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
