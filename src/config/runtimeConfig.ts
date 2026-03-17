type RuntimeConfig = {
  apiUrl: string;
  authUrl: string;
  enableMouthpieceCloud: boolean;
  oauthProtocol: string;
  oauthAuthBridgeUrl: string;
  oauthCallbackUrl: string;
};

const env = (typeof import.meta !== "undefined" && (import.meta as any).env) || {};

const readBooleanFlag = (value: unknown): boolean => String(value || "").trim().toLowerCase() === "true";

const readRendererRuntimeConfig = (): RuntimeConfig => {
  const preloadConfig =
    typeof window !== "undefined" ? window.electronAPI?.runtimeConfig : undefined;

  return {
    apiUrl: (
      preloadConfig?.apiUrl ||
      env.VITE_MOUTHPIECE_API_URL ||
      env.VITE_OPENWHISPR_API_URL ||
      ""
    ).trim(),
    authUrl: (preloadConfig?.authUrl || env.VITE_NEON_AUTH_URL || "").trim(),
    enableMouthpieceCloud: readBooleanFlag(
      preloadConfig?.enableMouthpieceCloud || env.VITE_ENABLE_MOUTHPIECE_CLOUD
    ),
    oauthProtocol: (
      preloadConfig?.oauthProtocol ||
      env.VITE_MOUTHPIECE_PROTOCOL ||
      env.VITE_OPENWHISPR_PROTOCOL ||
      ""
    ).trim(),
    oauthAuthBridgeUrl: (
      preloadConfig?.oauthAuthBridgeUrl ||
      env.VITE_MOUTHPIECE_AUTH_BRIDGE_URL ||
      env.VITE_OPENWHISPR_AUTH_BRIDGE_URL ||
      ""
    ).trim(),
    oauthCallbackUrl: (
      preloadConfig?.oauthCallbackUrl ||
      env.VITE_MOUTHPIECE_OAUTH_CALLBACK_URL ||
      env.VITE_OPENWHISPR_OAUTH_CALLBACK_URL ||
      ""
    ).trim(),
  };
};

export const RUNTIME_CONFIG = readRendererRuntimeConfig();
