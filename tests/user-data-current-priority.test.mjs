import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadModule() {
  return require(path.resolve(process.cwd(), "src/helpers/userDataPathResolver.js"));
}

async function withTempDir(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "mouthpiece-userdata-priority-"));
  try {
    return await run(tempDir);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

test("current userData with even a small .env beats a much larger legacy directory", async () => {
  const mod = loadModule();
  await withTempDir(async (appDataRoot) => {
    const currentDir = path.join(appDataRoot, "Mouthpiece");
    const legacyDir = path.join(appDataRoot, "OpenWhispr");

    // Current has a small but real .env (user just moved keys here)
    await fs.mkdir(currentDir, { recursive: true });
    await fs.writeFile(path.join(currentDir, ".env"), "DICTATION_KEY=RightCommand\n");

    // Legacy looks "bigger" because the user used the old build a lot
    await fs.mkdir(path.join(legacyDir, "Local Storage", "leveldb"), { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "Local Storage", "leveldb", "000003.log"),
      "garbage data\n".repeat(1024)
    );
    await fs.writeFile(
      path.join(legacyDir, "transcriptions.db-wal"),
      "x".repeat(64 * 1024)
    );
    await fs.writeFile(path.join(legacyDir, ".env"), "OPENAI_API_KEY=stale\n");

    const result = mod.resolveUserDataPath({
      appDataRoot,
      channel: "production",
      currentUserDataBaseName: "Mouthpiece",
      legacyUserDataBaseNames: ["OpenWhispr"],
    });

    assert.equal(
      result.selectedPath,
      currentDir,
      "current userData with non-zero score must win regardless of legacy size"
    );
  });
});

test("only legacy exists: resolver picks legacy AND copies state into current so subsequent boots use current", async () => {
  const mod = loadModule();
  await withTempDir(async (appDataRoot) => {
    const currentDir = path.join(appDataRoot, "Mouthpiece");
    const legacyDir = path.join(appDataRoot, "OpenWhispr");

    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, ".env"), "DICTATION_KEY=Globe\n");
    await fs.writeFile(path.join(legacyDir, "transcriptions.db"), "sqlite-bytes-here");

    // First boot: resolver should select legacy and migrate to current.
    const first = mod.resolveUserDataPath({
      appDataRoot,
      channel: "production",
      currentUserDataBaseName: "Mouthpiece",
      legacyUserDataBaseNames: ["OpenWhispr"],
    });
    // Either the resolver returns currentDir (eager migration) or returns legacyDir
    // and a separate migration step runs. Both behaviors must end with current
    // populated by the next boot. We require current to exist with the migrated
    // .env after resolveUserDataPath returns OR for the resolver to expose a
    // migration hook on its result.
    assert.ok(
      first.selectedPath === currentDir || first.selectedPath === legacyDir,
      `expected selectedPath to be current or legacy, got ${first.selectedPath}`
    );

    // The resolver must either copy the .env to currentDir directly OR return a
    // migration descriptor that the caller can act on. Until that is implemented
    // this assertion will fail.
    let currentEnv = "";
    try {
      currentEnv = await fs.readFile(path.join(currentDir, ".env"), "utf8");
    } catch {}
    const reportedMigration =
      first.migratedFrom ||
      (first.reason && /migrate|copy/i.test(String(first.reason)));
    assert.ok(
      currentEnv.includes("DICTATION_KEY=Globe") || reportedMigration,
      "resolver must either eagerly copy legacy state into current OR report a migration target so caller can run the copy"
    );
  });
});

test("current userData empty / nonexistent and legacy populated: legacy wins (existing behavior preserved)", async () => {
  const mod = loadModule();
  await withTempDir(async (appDataRoot) => {
    const legacyDir = path.join(appDataRoot, "OpenWhispr");
    await fs.mkdir(path.join(legacyDir, "Local Storage", "leveldb"), { recursive: true });
    await fs.writeFile(
      path.join(legacyDir, "Local Storage", "leveldb", "000003.log"),
      "x".repeat(8192)
    );
    await fs.writeFile(path.join(legacyDir, ".env"), "K=V\n");

    const result = mod.resolveUserDataPath({
      appDataRoot,
      channel: "production",
      currentUserDataBaseName: "Mouthpiece",
      legacyUserDataBaseNames: ["OpenWhispr"],
    });
    assert.equal(result.selectedPath, legacyDir);
  });
});
