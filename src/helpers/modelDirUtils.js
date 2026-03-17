const { app } = require("electron");
const os = require("os");
const path = require("path");
const fs = require("fs");
const productIdentity = require("../config/productIdentity");

function getCacheDir() {
  const homeDir = app?.getPath?.("home") || os.homedir();
  return path.join(homeDir, ".cache", productIdentity.CURRENT_CACHE_DIRNAME);
}

function getLegacyCacheDir() {
  const homeDir = app?.getPath?.("home") || os.homedir();
  return path.join(homeDir, ".cache", productIdentity.LEGACY_CACHE_DIRNAME);
}

function migrateCacheIfNeeded() {
  const legacyDir = getLegacyCacheDir();
  const currentDir = getCacheDir();

  if (!fs.existsSync(legacyDir) || fs.existsSync(currentDir)) {
    return;
  }

  try {
    fs.mkdirSync(path.dirname(currentDir), { recursive: true });
    fs.renameSync(legacyDir, currentDir);
    console.log(`[Cache Migration] Migrated from ${legacyDir} to ${currentDir}`);
  } catch (err) {
    console.error(`[Cache Migration] Failed to migrate cache: ${err.message}`);
  }
}

function getModelsDirForService(service) {
  migrateCacheIfNeeded();
  const cacheDir = getCacheDir();
  return path.join(cacheDir, `${service}-models`);
}

module.exports = { getModelsDirForService, getCacheDir, getLegacyCacheDir, migrateCacheIfNeeded };
