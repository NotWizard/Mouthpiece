const VALID_APP_CHANNELS = /** @type {const} */ (["development", "staging", "production"]);

const DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL = /** @type {const} */ ({
  development: "mouthpiece-dev",
  staging: "mouthpiece-staging",
  production: "mouthpiece",
});

const PRODUCT_NAME = "Mouthpiece";
const BASE_WINDOWS_APP_ID = "com.mouthpiece.app";
const CURRENT_USER_DATA_BASENAME = PRODUCT_NAME;
const LEGACY_USER_DATA_BASENAMES = /** @type {const} */ (["OpenWhispr", "Voice" + "Ink"]);
const LEGACY_CACHE_DIRNAME = "openwhispr";

module.exports = {
  VALID_APP_CHANNELS,
  DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL,
  PRODUCT_NAME,
  BASE_WINDOWS_APP_ID,
  CURRENT_USER_DATA_BASENAME,
  LEGACY_USER_DATA_BASENAMES,
  LEGACY_CACHE_DIRNAME,
};
