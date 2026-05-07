import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { dump, load } = require("js-yaml");

function ensureMetadataObject(metadata, label) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error(`${label} is not valid update metadata.`);
  }

  if (!Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error(`${label} does not contain any downloadable files.`);
  }

  return metadata;
}

function normalizeFileEntry(fileInfo, label) {
  if (!fileInfo || typeof fileInfo !== "object") {
    throw new Error(`${label} contains an invalid file entry.`);
  }

  if (typeof fileInfo.url !== "string" || fileInfo.url.length === 0) {
    throw new Error(`${label} contains a file without a url.`);
  }

  return {
    ...fileInfo,
    url: fileInfo.url,
  };
}

export function parseUpdateMetadata(yamlText, label = "Update metadata") {
  return ensureMetadataObject(load(yamlText), label);
}

export function mergeMacUpdateMetadata({ x64Yaml, arm64Yaml }) {
  const x64Metadata = parseUpdateMetadata(x64Yaml, "x64 mac update metadata");
  const arm64Metadata = parseUpdateMetadata(arm64Yaml, "arm64 mac update metadata");

  if (x64Metadata.version !== arm64Metadata.version) {
    throw new Error(
      `Mac update metadata versions do not match: ${x64Metadata.version} vs ${arm64Metadata.version}.`
    );
  }

  const mergedFiles = [];
  const seenUrls = new Set();

  for (const fileInfo of [...x64Metadata.files, ...arm64Metadata.files]) {
    const normalizedFileInfo = normalizeFileEntry(fileInfo, "Merged mac update metadata");
    if (seenUrls.has(normalizedFileInfo.url)) {
      continue;
    }
    seenUrls.add(normalizedFileInfo.url);
    mergedFiles.push(normalizedFileInfo);
  }

  const mergedMetadata = {
    ...x64Metadata,
    files: mergedFiles,
    path: x64Metadata.path || mergedFiles[0]?.url,
    sha512: x64Metadata.sha512 || mergedFiles[0]?.sha512,
    releaseDate:
      typeof x64Metadata.releaseDate === "string" &&
      typeof arm64Metadata.releaseDate === "string" &&
      arm64Metadata.releaseDate > x64Metadata.releaseDate
        ? arm64Metadata.releaseDate
        : x64Metadata.releaseDate || arm64Metadata.releaseDate,
  };

  return dump(mergedMetadata, {
    noRefs: true,
    lineWidth: -1,
    sortKeys: false,
  });
}

function assertAssetPresent(assetNames, assetName, context) {
  if (!assetNames.includes(assetName)) {
    throw new Error(`${context} references missing asset "${assetName}".`);
  }
}

function validateRequiredAssetPatterns(assetNames) {
  const requiredPatterns = [
    [/^latest\.yml$/, "latest.yml"],
    [/^latest-linux\.yml$/, "latest-linux.yml"],
    [/^latest-mac\.yml$/, "latest-mac.yml"],
    [/^latest-arm64-mac\.yml$/, "latest-arm64-mac.yml"],
    [/^latest-x64-mac\.yml$/, "latest-x64-mac.yml"],
    [/^Mouthpiece-Setup-.*\.exe$/, "Windows NSIS installer"],
    [/^Mouthpiece-.*-linux-.*\.AppImage$/, "Linux AppImage"],
    [/^Mouthpiece-(?!.*arm64).*?-mac\.zip$/, "macOS x64 zip"],
    [/^Mouthpiece-.*-arm64-mac\.zip$/, "macOS arm64 zip"],
    [/^Mouthpiece-(?!.*arm64).*\.dmg$/, "macOS x64 DMG"],
    [/^Mouthpiece-.*-arm64\.dmg$/, "macOS arm64 DMG"],
  ];

  for (const [pattern, label] of requiredPatterns) {
    if (!assetNames.some((assetName) => pattern.test(assetName))) {
      throw new Error(`Release assets are missing ${label}.`);
    }
  }
}

function validateReferencedAssets(assetNames, metadata, label) {
  const normalizedMetadata = ensureMetadataObject(metadata, label);
  for (const fileInfo of normalizedMetadata.files) {
    const normalizedFileInfo = normalizeFileEntry(fileInfo, label);
    assertAssetPresent(assetNames, normalizedFileInfo.url, label);
  }
}

function validateWindowsMetadata(assetNames, latestWindowsYaml) {
  if (!latestWindowsYaml) {
    return;
  }

  const metadata = parseUpdateMetadata(latestWindowsYaml, "latest.yml");
  validateReferencedAssets(assetNames, metadata, "latest.yml");

  if (!metadata.files.some((fileInfo) => fileInfo.url.endsWith(".exe"))) {
    throw new Error("latest.yml must reference the NSIS installer.");
  }
}

function validateLinuxMetadata(assetNames, latestLinuxYaml) {
  if (!latestLinuxYaml) {
    return;
  }

  const metadata = parseUpdateMetadata(latestLinuxYaml, "latest-linux.yml");
  validateReferencedAssets(assetNames, metadata, "latest-linux.yml");

  if (!metadata.files.some((fileInfo) => fileInfo.url.endsWith(".AppImage"))) {
    throw new Error("latest-linux.yml must reference an AppImage asset.");
  }
}

function validateMacArchMetadata(assetNames, yamlText, label, expectedArm64) {
  if (!yamlText) {
    return;
  }

  const metadata = parseUpdateMetadata(yamlText, label);
  validateReferencedAssets(assetNames, metadata, label);

  const archiveFiles = metadata.files.filter((fileInfo) => {
    const url = String(fileInfo.url);
    return url.endsWith(".zip") || url.endsWith(".dmg");
  });

  if (archiveFiles.length === 0) {
    throw new Error(`${label} must reference at least one macOS archive asset.`);
  }

  for (const fileInfo of archiveFiles) {
    const isArm64 = String(fileInfo.url).includes("arm64");
    if (isArm64 !== expectedArm64) {
      throw new Error(
        `${label} must reference ${expectedArm64 ? "only arm64" : "only x64"} archive assets.`
      );
    }
  }
}

function validateMergedMacMetadata(assetNames, latestMacYaml) {
  if (!latestMacYaml) {
    return;
  }

  const metadata = parseUpdateMetadata(latestMacYaml, "latest-mac.yml");
  validateReferencedAssets(assetNames, metadata, "latest-mac.yml");

  const zipUrls = metadata.files
    .map((fileInfo) => String(fileInfo.url))
    .filter((url) => url.endsWith(".zip"));

  if (!zipUrls.some((url) => url.includes("arm64"))) {
    throw new Error("latest-mac.yml must include an arm64 zip asset.");
  }

  if (!zipUrls.some((url) => !url.includes("arm64"))) {
    throw new Error("latest-mac.yml must include an x64 zip asset.");
  }
}

export function getAssetNamesFromReleaseJson(releaseJsonText) {
  const parsed = JSON.parse(releaseJsonText);
  const assets = Array.isArray(parsed) ? parsed : parsed?.assets;

  if (!Array.isArray(assets)) {
    throw new Error("Release JSON does not contain an assets array.");
  }

  return assets
    .map((asset) => asset?.name)
    .filter((assetName) => typeof assetName === "string" && assetName.length > 0);
}

export function getAssetsFromReleaseJson(releaseJsonText) {
  const parsed = JSON.parse(releaseJsonText);
  const assets = Array.isArray(parsed) ? parsed : parsed?.assets;

  if (!Array.isArray(assets)) {
    throw new Error("Release JSON does not contain an assets array.");
  }

  return assets.filter((asset) => asset && typeof asset === "object");
}

function findReleaseAsset(assets, assetName) {
  const asset = assets.find((candidate) => candidate?.name === assetName);
  if (!asset) {
    throw new Error(`Release assets are missing ${assetName}.`);
  }
  return asset;
}

function normalizeSha256Digest(asset) {
  const digest = asset?.digest;
  const assetName = asset?.name || "release asset";

  if (typeof digest !== "string" || !digest.startsWith("sha256:")) {
    throw new Error(`${assetName} is missing a sha256 digest.`);
  }

  const sha256 = digest.slice("sha256:".length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error(`${assetName} has an invalid sha256 digest.`);
  }

  return sha256;
}

export function getHomebrewCaskReleaseInfo({ releaseJsonText, version }) {
  const normalizedVersion = String(version || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+/.test(normalizedVersion)) {
    throw new Error("A semantic release version is required.");
  }

  const assets = getAssetsFromReleaseJson(releaseJsonText);
  const arm64AssetName = `Mouthpiece-${normalizedVersion}-arm64.dmg`;
  const intelAssetName = `Mouthpiece-${normalizedVersion}.dmg`;
  const arm64Asset = findReleaseAsset(assets, arm64AssetName);
  const intelAsset = findReleaseAsset(assets, intelAssetName);

  return {
    version: normalizedVersion,
    arm64AssetName,
    arm64Sha256: normalizeSha256Digest(arm64Asset),
    intelAssetName,
    intelSha256: normalizeSha256Digest(intelAsset),
  };
}

export function renderHomebrewCask(releaseInfo) {
  return `cask "mouthpiece" do
  on_arm do
    version "${releaseInfo.version}"
    sha256 "${releaseInfo.arm64Sha256}"

    url "https://github.com/NotWizard/Mouthpiece/releases/download/v#{version}/Mouthpiece-#{version}-arm64.dmg"
  end

  on_intel do
    version "${releaseInfo.version}"
    sha256 "${releaseInfo.intelSha256}"

    url "https://github.com/NotWizard/Mouthpiece/releases/download/v#{version}/Mouthpiece-#{version}.dmg"
  end

  name "Mouthpiece"
  desc "Desktop dictation app using whisper.cpp"
  homepage "https://github.com/NotWizard/Mouthpiece"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Mouthpiece.app"

  zap trash: [
    "~/Library/Application Support/Mouthpiece",
    "~/Library/Caches/com.mouthpiece.app",
    "~/Library/Logs/Mouthpiece",
    "~/Library/Preferences/com.mouthpiece.app.plist",
  ]
end
`;
}

export function validateReleaseAssets({
  assetNames,
  latestWindowsYaml = "",
  latestLinuxYaml = "",
  latestMacYaml = "",
  latestArm64Yaml = "",
  latestX64Yaml = "",
}) {
  if (!Array.isArray(assetNames) || assetNames.length === 0) {
    throw new Error("Release assets list is empty.");
  }

  validateRequiredAssetPatterns(assetNames);
  validateWindowsMetadata(assetNames, latestWindowsYaml);
  validateLinuxMetadata(assetNames, latestLinuxYaml);
  validateMergedMacMetadata(assetNames, latestMacYaml);
  validateMacArchMetadata(assetNames, latestArm64Yaml, "latest-arm64-mac.yml", true);
  validateMacArchMetadata(assetNames, latestX64Yaml, "latest-x64-mac.yml", false);
}
