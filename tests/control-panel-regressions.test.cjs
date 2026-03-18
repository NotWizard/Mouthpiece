const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CURRENT_CACHE_DIRNAME,
  LEGACY_CACHE_DIRNAME,
} = require("../src/config/productIdentity");
const {
  shouldShowSidebarAccountSection,
} = require("../src/utils/sidebarAccountState");
const {
  getModelCachePathHint,
  getModelCacheDir,
  migrateLegacyModelCacheDir,
} = require("../src/utils/modelCachePaths");

test("signed-out users no longer show a sidebar account section", () => {
  assert.equal(
    shouldShowSidebarAccountSection({
      isSignedIn: false,
      userName: null,
      userEmail: null,
    }),
    false
  );
});

test("model cache hint uses the current Mouthpiece cache directory name", () => {
  assert.equal(
    getModelCachePathHint({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      cacheDirName: CURRENT_CACHE_DIRNAME,
    }),
    "~/.cache/mouthpiece"
  );
});

test("legacy local model cache directories migrate to the current Mouthpiece path", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mouthpiece-cache-test-"));
  const homeDir = path.join(tempRoot, "home");
  const legacyModelsDir = getModelCacheDir(homeDir, LEGACY_CACHE_DIRNAME);
  const currentModelsDir = getModelCacheDir(homeDir, CURRENT_CACHE_DIRNAME);

  fs.mkdirSync(legacyModelsDir, { recursive: true });
  fs.writeFileSync(path.join(legacyModelsDir, "example.gguf"), "model");

  const result = migrateLegacyModelCacheDir({
    homeDir,
    currentCacheDirName: CURRENT_CACHE_DIRNAME,
    legacyCacheDirName: LEGACY_CACHE_DIRNAME,
  });

  assert.equal(result.migrated, true);
  assert.equal(result.currentDir, currentModelsDir);
  assert.equal(fs.existsSync(path.join(currentModelsDir, "example.gguf")), true);
  assert.equal(fs.existsSync(legacyModelsDir), false);

  fs.rmSync(tempRoot, { recursive: true, force: true });
});
