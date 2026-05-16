import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function loadModule(relativePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mouthpiece-terminology-test-"));
  const outfile = path.join(tempDir, "module.bundle.mjs");

  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), relativePath)],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile,
    logLevel: "silent",
  });

  const imported = await import(`${pathToFileURL(outfile).href}?ts=${Date.now()}`);

  return {
    module: imported,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("legacy custom dictionary migrates into preferred terms without losing existing entries", async () => {
  const { module: mod, cleanup } = await loadModule("src/utils/terminologyMigration.ts");

  try {
    const profile = mod.migrateLegacyDictionaryToTerminologyProfile([
      " Raycast ",
      "Gmail",
      "Raycast",
    ]);

    assert.deepEqual(profile.preferredTerms, ["Raycast", "Gmail"]);
    assert.deepEqual(profile.blacklistedTerms, []);
    assert.deepEqual(profile.homophoneMappings, []);
    assert.deepEqual(profile.glossaryTerms, []);
  } finally {
    cleanup();
  }
});

test("terminology profiles normalize duplicates and expose a word-boost friendly dictionary list", async () => {
  const { module: mod, cleanup } = await loadModule("src/utils/terminologyProfile.ts");

  try {
    const profile = mod.normalizeTerminologyProfile({
      preferredTerms: ["Acme", "Acme", "  Mouthpiece  "],
      blacklistedTerms: ["umm", "umm"],
      homophoneMappings: [
        { source: "race cast", target: "Raycast" },
        { source: "race cast", target: "Raycast" },
      ],
      glossaryTerms: ["Project Atlas", "Project Atlas"],
    });

    assert.deepEqual(profile.preferredTerms, ["Acme", "Mouthpiece"]);
    assert.deepEqual(profile.blacklistedTerms, ["umm"]);
    assert.deepEqual(profile.homophoneMappings, [{ source: "race cast", target: "Raycast" }]);
    assert.deepEqual(profile.glossaryTerms, ["Project Atlas"]);
    assert.deepEqual(mod.terminologyProfileToDictionary(profile), [
      "Acme",
      "Mouthpiece",
      "Project Atlas",
    ]);
  } finally {
    cleanup();
  }
});
