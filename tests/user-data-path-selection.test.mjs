import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadUserDataPathResolverModule() {
  try {
    return require(path.resolve(process.cwd(), "src/helpers/userDataPathResolver.js"));
  } catch {
    return {};
  }
}

async function withTempDir(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mouthpiece-user-data-"));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test("legacy userData with Chromium storage beats an empty current directory after an app rename", async () => {
  const mod = loadUserDataPathResolverModule();

  assert.equal(typeof mod.resolveUserDataPath, "function");

  await withTempDir(async (appDataRoot) => {
    const currentDir = path.join(appDataRoot, "Mouthpiece");
    const legacyDir = path.join(appDataRoot, "VoiceInk");

    await fs.mkdir(currentDir, { recursive: true });
    await fs.mkdir(path.join(legacyDir, "Local Storage", "leveldb"), { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "Local Storage", "leveldb", "000003.log"),
      "dictationKey=RightCommand\n".repeat(256)
    );

    const result = mod.resolveUserDataPath({
      appDataRoot,
      channel: "production",
      currentUserDataBaseName: "Mouthpiece",
      legacyUserDataBaseNames: ["OpenWhispr", "VoiceInk"],
    });

    assert.equal(result.selectedPath, legacyDir);
    assert.equal(result.reason, "legacy-higher-score:VoiceInk");
  });
});

test("current userData with a persisted env file still outranks legacy Chromium-only state", async () => {
  const mod = loadUserDataPathResolverModule();

  assert.equal(typeof mod.resolveUserDataPath, "function");

  await withTempDir(async (appDataRoot) => {
    const currentDir = path.join(appDataRoot, "Mouthpiece");
    const legacyDir = path.join(appDataRoot, "VoiceInk");

    await fs.mkdir(currentDir, { recursive: true });
    await fs.writeFile(path.join(currentDir, ".env"), "DICTATION_KEY=RightCommand\n");

    await fs.mkdir(path.join(legacyDir, "Local Storage", "leveldb"), { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "Local Storage", "leveldb", "000003.log"),
      "dictationKey=F8\n".repeat(64)
    );

    const result = mod.resolveUserDataPath({
      appDataRoot,
      channel: "production",
      currentUserDataBaseName: "Mouthpiece",
      legacyUserDataBaseNames: ["OpenWhispr", "VoiceInk"],
    });

    assert.equal(result.selectedPath, currentDir);
    assert.equal(result.reason, "current-higher-or-equal-score");
  });
});

test("explicit userData override still wins before any directory scoring runs", () => {
  const mod = loadUserDataPathResolverModule();

  assert.equal(typeof mod.resolveUserDataPath, "function");

  const result = mod.resolveUserDataPath({
    override: "/tmp/custom-mouthpiece-user-data",
    appDataRoot: "/tmp/app-data",
    channel: "production",
    currentUserDataBaseName: "Mouthpiece",
    legacyUserDataBaseNames: ["OpenWhispr", "VoiceInk"],
  });

  assert.deepEqual(result, {
    selectedPath: "/tmp/custom-mouthpiece-user-data",
    reason: "env-override",
  });
});
