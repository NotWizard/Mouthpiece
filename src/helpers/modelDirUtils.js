const { app } = require("electron");
const os = require("os");
const path = require("path");
const productIdentity = require("../config/productIdentity");

function getModelsDirForService(service) {
  const homeDir = app?.getPath?.("home") || os.homedir();
  return path.join(homeDir, ".cache", productIdentity.LEGACY_CACHE_DIRNAME, `${service}-models`);
}

module.exports = { getModelsDirForService };
