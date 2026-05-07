import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const scriptModuleUrl = pathToFileURL(
  path.resolve(process.cwd(), "scripts/lib/release-update-metadata.mjs")
).href;

async function loadReleaseMetadataModule() {
  return import(scriptModuleUrl);
}

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("mergeMacUpdateMetadata combines x64 and arm64 manifests into one latest-mac feed", async () => {
  const { mergeMacUpdateMetadata } = await loadReleaseMetadataModule();

  const merged = mergeMacUpdateMetadata({
    x64Yaml: `
version: 1.2.3
files:
  - url: Mouthpiece-1.2.3-mac.zip
    sha512: x64zip
    size: 111
  - url: Mouthpiece-1.2.3.dmg
    sha512: x64dmg
    size: 222
path: Mouthpiece-1.2.3-mac.zip
sha512: x64zip
releaseDate: '2026-03-19T00:00:00.000Z'
`,
    arm64Yaml: `
version: 1.2.3
files:
  - url: Mouthpiece-1.2.3-arm64-mac.zip
    sha512: armzip
    size: 333
  - url: Mouthpiece-1.2.3-arm64.dmg
    sha512: armdmg
    size: 444
path: Mouthpiece-1.2.3-arm64-mac.zip
sha512: armzip
releaseDate: '2026-03-19T00:00:00.000Z'
`,
  });

  assert.match(merged, /Mouthpiece-1\.2\.3-mac\.zip/);
  assert.match(merged, /Mouthpiece-1\.2\.3-arm64-mac\.zip/);
  assert.match(merged, /Mouthpiece-1\.2\.3\.dmg/);
  assert.match(merged, /Mouthpiece-1\.2\.3-arm64\.dmg/);
});

test("validateReleaseAssets rejects releases missing Linux updater metadata", async () => {
  const { validateReleaseAssets } = await loadReleaseMetadataModule();

  assert.throws(
    () =>
      validateReleaseAssets({
        assetNames: [
          "latest.yml",
          "latest-mac.yml",
          "latest-arm64-mac.yml",
          "latest-x64-mac.yml",
          "Mouthpiece-Setup-1.2.3.exe",
          "Mouthpiece-1.2.3-mac.zip",
          "Mouthpiece-1.2.3-arm64-mac.zip",
          "Mouthpiece-1.2.3.dmg",
          "Mouthpiece-1.2.3-arm64.dmg",
          "Mouthpiece-1.2.3-linux-x86_64.AppImage",
        ],
      }),
    /latest-linux\.yml/,
  );
});

test("renderHomebrewCask builds the Mouthpiece cask from release asset digests", async () => {
  const { getHomebrewCaskReleaseInfo, renderHomebrewCask } = await loadReleaseMetadataModule();

  const releaseInfo = getHomebrewCaskReleaseInfo({
    version: "v1.2.3",
    releaseJsonText: JSON.stringify({
      assets: [
        {
          name: "Mouthpiece-1.2.3-arm64.dmg",
          digest: `sha256:${"a".repeat(64)}`,
        },
        {
          name: "Mouthpiece-1.2.3.dmg",
          digest: `sha256:${"b".repeat(64)}`,
        },
      ],
    }),
  });

  const cask = renderHomebrewCask(releaseInfo);

  assert.match(cask, /version "1\.2\.3"/);
  assert.match(cask, /sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"/);
  assert.match(cask, /sha256 "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"/);
  assert.match(cask, /Mouthpiece-\#\{version\}-arm64\.dmg/);
  assert.match(cask, /Mouthpiece-\#\{version\}\.dmg/);
});

test("getHomebrewCaskReleaseInfo rejects DMG assets without GitHub sha256 digests", async () => {
  const { getHomebrewCaskReleaseInfo } = await loadReleaseMetadataModule();

  assert.throws(
    () =>
      getHomebrewCaskReleaseInfo({
        version: "1.2.3",
        releaseJsonText: JSON.stringify({
          assets: [
            {
              name: "Mouthpiece-1.2.3-arm64.dmg",
              digest: `sha256:${"a".repeat(64)}`,
            },
            {
              name: "Mouthpiece-1.2.3.dmg",
            },
          ],
        }),
      }),
    /missing a sha256 digest/,
  );
});

test("release workflow uploads Linux metadata, merges mac metadata, and validates release assets", async () => {
  const workflowSource = await readRepoFile(".github/workflows/release.yml");

  assert.match(workflowSource, /latest-linux\.yml/);
  assert.match(workflowSource, /merge-mac-update-metadata\.mjs/);
  assert.match(workflowSource, /validate-release-assets\.mjs/);
  assert.match(workflowSource, /update-homebrew-cask\.mjs/);
  assert.match(workflowSource, /HOMEBREW_TAP_TOKEN/);
  assert.match(workflowSource, /NotWizard\/homebrew-mouthpiece/);
});
