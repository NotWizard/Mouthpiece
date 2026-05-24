const fs = require("fs");
const path = require("path");

// In production, VITE_* env vars aren't available in the main process because
// Vite only inlines them into the renderer bundle at build time. Load the
// runtime-env.json that the Vite build writes to src/dist/ as a fallback.
const runtimeEnv = (() => {
  const envPath = path.join(__dirname, "..", "dist", "runtime-env.json");
  try {
    if (fs.existsSync(envPath)) return JSON.parse(fs.readFileSync(envPath, "utf8"));
  } catch {}
  return {};
})();

const getOauthProtocol = () =>
  process.env.MOUTHPIECE_PROTOCOL ||
  process.env.VITE_MOUTHPIECE_PROTOCOL ||
  process.env.OPENWHISPR_PROTOCOL ||
  process.env.VITE_OPENWHISPR_PROTOCOL ||
  runtimeEnv.VITE_MOUTHPIECE_PROTOCOL ||
  runtimeEnv.VITE_OPENWHISPR_PROTOCOL ||
  "";

const getApiUrl = () =>
  process.env.MOUTHPIECE_API_URL ||
  process.env.VITE_MOUTHPIECE_API_URL ||
  process.env.OPENWHISPR_API_URL ||
  process.env.VITE_OPENWHISPR_API_URL ||
  runtimeEnv.VITE_MOUTHPIECE_API_URL ||
  runtimeEnv.VITE_OPENWHISPR_API_URL ||
  "";

const getAuthUrl = () =>
  process.env.NEON_AUTH_URL ||
  process.env.VITE_NEON_AUTH_URL ||
  runtimeEnv.VITE_NEON_AUTH_URL ||
  "";

const getAuthBridgeUrl = () => {
  const configured =
    process.env.MOUTHPIECE_AUTH_BRIDGE_URL ||
    process.env.VITE_MOUTHPIECE_AUTH_BRIDGE_URL ||
    process.env.OPENWHISPR_AUTH_BRIDGE_URL ||
    process.env.VITE_OPENWHISPR_AUTH_BRIDGE_URL ||
    runtimeEnv.VITE_MOUTHPIECE_AUTH_BRIDGE_URL ||
    runtimeEnv.VITE_OPENWHISPR_AUTH_BRIDGE_URL ||
    "";

  if (configured) {
    return configured;
  }

  const rawPort = (
    process.env.MOUTHPIECE_AUTH_BRIDGE_PORT ||
    process.env.OPENWHISPR_AUTH_BRIDGE_PORT ||
    ""
  ).trim();
  const parsedPort = Number(rawPort);
  const port =
    Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 5199;

  return `http://127.0.0.1:${port}/oauth/callback`;
};

const getOAuthCallbackUrl = () =>
  process.env.MOUTHPIECE_OAUTH_CALLBACK_URL ||
  process.env.VITE_MOUTHPIECE_OAUTH_CALLBACK_URL ||
  process.env.OPENWHISPR_OAUTH_CALLBACK_URL ||
  process.env.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
  runtimeEnv.VITE_MOUTHPIECE_OAUTH_CALLBACK_URL ||
  runtimeEnv.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
  "";

const buildRuntimeConfig = () => ({
  apiUrl: getApiUrl(),
  authUrl: getAuthUrl(),
  enableMouthpieceCloud:
    String(
      process.env.VITE_ENABLE_MOUTHPIECE_CLOUD ||
        process.env.OPENWHISPR_ENABLE_MOUTHPIECE_CLOUD ||
        ""
    )
      .trim()
      .toLowerCase() === "true",
  oauthProtocol: getOauthProtocol(),
  oauthAuthBridgeUrl: getAuthBridgeUrl(),
  oauthCallbackUrl: getOAuthCallbackUrl(),
});

// CLI arg prefix used by preload.js to pick up the runtime config that
// windowManager injects via webPreferences.additionalArguments. Keeping the
// constant here so both producer and consumer can't drift.
const RUNTIME_CONFIG_ARGV_PREFIX = "--runtime-config=";

module.exports = {
  buildRuntimeConfig,
  getApiUrl,
  getAuthUrl,
  getAuthBridgeUrl,
  getOauthProtocol,
  getOAuthCallbackUrl,
  RUNTIME_CONFIG_ARGV_PREFIX,
};
