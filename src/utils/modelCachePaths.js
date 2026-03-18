const fs = require("fs");
const path = require("path");

function getModelCacheBaseDir(homeDir, cacheDirName) {
  return path.join(homeDir, ".cache", cacheDirName);
}

function getModelCacheDir(homeDir, cacheDirName) {
  return path.join(getModelCacheBaseDir(homeDir, cacheDirName), "models");
}

function getModelCachePathHint({ userAgent = "", cacheDirName }) {
  if (/Windows/i.test(userAgent)) {
    return `%USERPROFILE%\\.cache\\${cacheDirName}`;
  }

  return `~/.cache/${cacheDirName}`;
}

function migrateLegacyModelCacheDir({
  homeDir,
  currentCacheDirName,
  legacyCacheDirName,
  fsImpl = fs,
} = {}) {
  const legacyDir = getModelCacheDir(homeDir, legacyCacheDirName);
  const currentDir = getModelCacheDir(homeDir, currentCacheDirName);

  if (!fsImpl.existsSync(legacyDir) || fsImpl.existsSync(currentDir)) {
    return { migrated: false, legacyDir, currentDir };
  }

  fsImpl.mkdirSync(path.dirname(currentDir), { recursive: true });
  fsImpl.renameSync(legacyDir, currentDir);

  return { migrated: true, legacyDir, currentDir };
}

function resolveModelCacheDir({
  homeDir,
  currentCacheDirName,
  legacyCacheDirName,
  fsImpl = fs,
} = {}) {
  const migration = migrateLegacyModelCacheDir({
    homeDir,
    currentCacheDirName,
    legacyCacheDirName,
    fsImpl,
  });

  return {
    ...migration,
    currentDir: getModelCacheDir(homeDir, currentCacheDirName),
  };
}

module.exports = {
  getModelCacheBaseDir,
  getModelCacheDir,
  getModelCachePathHint,
  migrateLegacyModelCacheDir,
  resolveModelCacheDir,
};
