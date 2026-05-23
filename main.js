const { app, globalShortcut, BrowserWindow, dialog, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { createAutomaticActivationSession } = require("./src/helpers/automaticActivation");
const productIdentity = require("./src/config/productIdentity");
const { resolveUserDataPath } = require("./src/helpers/userDataPathResolver");

const VALID_CHANNELS = new Set(productIdentity.VALID_APP_CHANNELS);
const DEFAULT_AUTH_BRIDGE_PORT = 5199;
const CURRENT_USER_DATA_BASENAME = productIdentity.CURRENT_USER_DATA_BASENAME;
const LEGACY_USER_DATA_BASENAMES = productIdentity.LEGACY_USER_DATA_BASENAMES;

function isElectronBinaryExec() {
  const execPath = (process.execPath || "").toLowerCase();
  return (
    execPath.includes("/electron.app/contents/macos/electron") ||
    execPath.endsWith("/electron") ||
    execPath.endsWith("\\electron.exe")
  );
}

function inferDefaultChannel() {
  if (process.env.NODE_ENV === "development" || process.defaultApp || isElectronBinaryExec()) {
    return "development";
  }
  return "production";
}

function resolveAppChannel() {
  const rawChannel = (
    process.env.MOUTHPIECE_CHANNEL ||
    process.env.OPENWHISPR_CHANNEL ||
    process.env.VITE_MOUTHPIECE_CHANNEL ||
    process.env.VITE_OPENWHISPR_CHANNEL ||
    ""
  )
    .trim()
    .toLowerCase();

  if (VALID_CHANNELS.has(rawChannel)) {
    return rawChannel;
  }

  return inferDefaultChannel();
}

const APP_CHANNEL = resolveAppChannel();
// Set both new and legacy env vars for backward compatibility
process.env.MOUTHPIECE_CHANNEL = APP_CHANNEL;
process.env.OPENWHISPR_CHANNEL = APP_CHANNEL;

function configureChannelUserDataPath() {
  const { selectedPath, reason } = resolveUserDataPath({
    override: process.env.MOUTHPIECE_USER_DATA_DIR || process.env.OPENWHISPR_USER_DATA_DIR,
    appDataRoot: app.getPath("appData"),
    currentUserDataBaseName: CURRENT_USER_DATA_BASENAME,
    legacyUserDataBaseNames: LEGACY_USER_DATA_BASENAMES,
    channel: APP_CHANNEL,
  });
  app.setPath("userData", selectedPath);
  process.env.OPENWHISPR_USER_DATA_DIR = selectedPath;
  console.log("[startup] userData path resolved", {
    channel: APP_CHANNEL,
    userDataPath: selectedPath,
    reason,
  });
}

configureChannelUserDataPath();

if (process.platform === "win32") {
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

// Group all windows under single taskbar entry on Windows
if (process.platform === "win32") {
  const windowsAppId =
    APP_CHANNEL === "production"
      ? productIdentity.BASE_WINDOWS_APP_ID
      : `${productIdentity.BASE_WINDOWS_APP_ID}.${APP_CHANNEL}`;
  app.setAppUserModelId(windowsAppId);
}

function getOAuthProtocol() {
  const fromEnv = (
    process.env.VITE_MOUTHPIECE_PROTOCOL ||
    process.env.MOUTHPIECE_PROTOCOL ||
    process.env.VITE_OPENWHISPR_PROTOCOL ||
    process.env.OPENWHISPR_PROTOCOL ||
    ""
  )
    .trim()
    .toLowerCase();

  if (/^[a-z][a-z0-9+.-]*$/.test(fromEnv)) {
    return fromEnv;
  }

  return (
    productIdentity.DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL[APP_CHANNEL] ||
    productIdentity.DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL.production
  );
}

const OAUTH_PROTOCOL = getOAuthProtocol();
// Set both new and legacy env vars for backward compatibility
process.env.MOUTHPIECE_PROTOCOL = OAUTH_PROTOCOL;
process.env.OPENWHISPR_PROTOCOL = OAUTH_PROTOCOL;

function shouldRegisterProtocolWithAppArg() {
  return Boolean(process.defaultApp) || isElectronBinaryExec();
}

// Register custom protocol for OAuth callbacks.
// In development, always include the app path argument so macOS/Windows
// can launch the project app instead of opening bare Electron.
function registerMouthpieceProtocol() {
  const protocol = OAUTH_PROTOCOL;

  if (shouldRegisterProtocolWithAppArg()) {
    const appArg = process.argv[1] ? path.resolve(process.argv[1]) : path.resolve(".");
    return app.setAsDefaultProtocolClient(protocol, process.execPath, [appArg]);
  }

  return app.setAsDefaultProtocolClient(protocol);
}

const protocolRegistered = registerMouthpieceProtocol();
if (!protocolRegistered) {
  console.warn(`[Auth] Failed to register ${OAUTH_PROTOCOL}:// protocol handler`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.exit(0);
}

const isLiveWindow = (window) => window && !window.isDestroyed();

// Ensure macOS menus use the proper casing for the app name
if (process.platform === "darwin" && app.getName() !== productIdentity.PRODUCT_NAME) {
  app.setName(productIdentity.PRODUCT_NAME);
}

// Add global error handling for uncaught exceptions
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Don't exit the process for EPIPE errors as they're harmless
  if (error.code === "EPIPE") {
    return;
  }
  // For other errors, log and continue
  console.error("Error stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Import helper module classes (but don't instantiate yet - wait for app.whenReady())
const EnvironmentManager = require("./src/helpers/environment");
const WindowManager = require("./src/helpers/windowManager");
const DatabaseManager = require("./src/helpers/database");
const ClipboardManager = require("./src/helpers/clipboard");
const WhisperManager = require("./src/helpers/whisper");
const ParakeetManager = require("./src/helpers/parakeet");
const QwenAsrManager = require("./src/helpers/qwenAsr");
const TrayManager = require("./src/helpers/tray");
const IPCHandlers = require("./src/helpers/ipcHandlers");
const UpdateManager = require("./src/helpers/updateManager");
const GlobeKeyManager = require("./src/helpers/globeKeyManager");
const {
  isGlobeLikeHotkey: isGlobeLikeHotkeyForRecovery,
  isRightSideModifier: isRightSideModifierForRecovery,
} = require("./src/helpers/hotkeyManager");
const DevServerManager = require("./src/helpers/devServerManager");
const WindowsKeyManager = require("./src/helpers/windowsKeyManager");
const TargetAppCapture = require("./src/helpers/targetAppCapture");
const WhisperCudaManager = require("./src/helpers/whisperCudaManager");
const { MacOSPermissionFlowManager } = require("./src/helpers/macOSPermissionFlow");
const { i18nMain, changeLanguage } = require("./src/helpers/i18nMain");

// Manager instances - initialized after app.whenReady()
let debugLogger = null;
let environmentManager = null;
let windowManager = null;
let hotkeyManager = null;

// Translation-hotkey state (P8.2). Renderer settings sync via the
// "apply-translation-hotkey" IPC channel.
//
// Both platforms now route the chord through their native key listener so
// the prefix-match rule from P9.1 ("translation hotkey = main modifier prefix
// + a regular key") works even when the prefix is something Electron's
// globalShortcut can't accept (Globe, RightCommand/RightOption, RightControl
// etc.). globalShortcut is no longer involved on either path.
let currentTranslationAccelerator = null;
function applyTranslationHotkey({ enabled, hotkey, mainHotkey } = {}) {
  const trimmed = typeof hotkey === "string" ? hotkey.trim() : "";
  const trimmedMain = typeof mainHotkey === "string" ? mainHotkey.trim() : "";
  const shouldRegister =
    !!enabled &&
    !!trimmed &&
    trimmed !== trimmedMain; // refuse if equal to main hotkey

  // Tear down any previously-active translation listener before re-applying.
  if (currentTranslationAccelerator) {
    if (process.platform === "win32" && windowsKeyManager?.stopTranslation) {
      windowsKeyManager.stopTranslation();
    }
    currentTranslationAccelerator = null;
  }

  if (!shouldRegister) {
    debugLogger?.debug?.("[TranslationHotkey] apply skipped", {
      enabled: !!enabled,
      hotkey: trimmed,
      mainHotkey: trimmedMain,
      reason: !enabled ? "disabled" : !trimmed ? "empty" : "conflict",
    });
    return { registered: false, reason: !enabled ? "disabled" : !trimmed ? "empty" : "conflict" };
  }

  // macOS: store the chord so the "key-down-with-mods" listener (registered
  // against globeKeyManager) can match it. The native Swift binary does the
  // actual keyDown detection.
  if (process.platform === "darwin") {
    currentTranslationAccelerator = trimmed;
    debugLogger?.debug?.("[TranslationHotkey] stored for native (darwin)", {
      accelerator: trimmed,
      mainHotkey: trimmedMain,
    });
    return { registered: true, accelerator: trimmed, transport: "native-key-listener" };
  }

  // Windows: spawn a second native listener child process via
  // windowsKeyManager.startTranslation, which emits "translation-key-down"
  // when the chord fires. We fall through to a degraded "stored only" state
  // if the listener binary is unavailable so the renderer still treats the
  // hotkey as registered for UI purposes — the unavailable case already
  // surfaces via the main listener's "unavailable" event.
  if (process.platform === "win32") {
    if (windowsKeyManager?.startTranslation) {
      windowsKeyManager.startTranslation(trimmed);
    }
    currentTranslationAccelerator = trimmed;
    debugLogger?.debug?.("[TranslationHotkey] stored for native (win32)", {
      accelerator: trimmed,
      mainHotkey: trimmedMain,
    });
    return { registered: true, accelerator: trimmed, transport: "native-key-listener" };
  }

  // Linux / other: no native listener path, accept the chord as a stored
  // value so the renderer doesn't show a register-failed UI, but the chord
  // simply won't trigger anything until a future native path lands.
  currentTranslationAccelerator = trimmed;
  return { registered: false, reason: "unsupported_platform" };
}
module.exports.applyTranslationHotkey = applyTranslationHotkey;

// IPC bridge: renderer settings store calls window.electronAPI.applyTranslationHotkey
// whenever translationEnabled / translationDictationKey / dictationKey changes.
ipcMain.on("apply-translation-hotkey", (_event, config) => {
  applyTranslationHotkey(config || {});
});
let databaseManager = null;
let clipboardManager = null;
let whisperManager = null;
let parakeetManager = null;
let qwenAsrManager = null;
let trayManager = null;
let updateManager = null;
let globeKeyManager = null;
let windowsKeyManager = null;
let targetAppCapture = null;
let whisperCudaManager = null;
let macOSPermissionFlowManager = null;
let ipcHandlersInstance = null;
let globeKeyAlertShown = false;
let authBridgeServer = null;
const authBridgeSockets = new Set();
let globeKeyRestartTimer = null;
let lastGlobeRecoveryAttempt = 0;
let lastWindowsRecoveryAttempt = 0;
const GLOBE_RECOVERY_MIN_INTERVAL_MS = 2000;
const WINDOWS_RECOVERY_MIN_INTERVAL_MS = 2000;

// startupReadyPromise resolves when startApp() finishes its core wiring so
// handlers that arrive early (second-instance, OAuth open-url) can wait for
// windowManager / hotkeyManager to exist before acting. Without this gate,
// macOS open-url and a second-instance launch racing against startApp() would
// silently drop their payload.
let resolveStartupReady;
const startupReadyPromise = new Promise((resolve) => {
  resolveStartupReady = resolve;
});

// OAuth deep links arriving before windowManager is ready (cold launch via
// mouthpiece://) are queued here and flushed once the control panel exists.
const pendingOAuthDeepLinks = [];

function flushPendingOAuthDeepLinks() {
  while (pendingOAuthDeepLinks.length > 0) {
    const url = pendingOAuthDeepLinks.shift();
    try {
      handleOAuthDeepLink(url);
    } catch (err) {
      debugLogger?.error?.("Failed to flush queued OAuth deep link", { error: err?.message });
    }
  }
}

// CGEvent.tapCreate fails permanently when Accessibility is revoked — there is
// no event to listen for re-grant. Re-spawn on app focus so the listener
// self-heals when the user returns from System Settings after authorizing.
function tryRecoverGlobeKeyListener(reason) {
  if (process.platform !== "darwin") return;
  if (!globeKeyManager || globeKeyManager.process) return;

  const currentHotkey = hotkeyManager?.getCurrentHotkey?.();
  if (!currentHotkey) return;
  if (
    !isGlobeLikeHotkeyForRecovery(currentHotkey) &&
    !isRightSideModifierForRecovery(currentHotkey)
  ) {
    return;
  }

  const now = Date.now();
  if (now - lastGlobeRecoveryAttempt < GLOBE_RECOVERY_MIN_INTERVAL_MS) return;
  lastGlobeRecoveryAttempt = now;

  debugLogger?.debug("[Globe] Listener appears dead, attempting recovery", {
    reason,
    currentHotkey,
  });
  globeKeyManager.start();
}

// The Windows low-level keyboard hook can be detached by AV / sleep / UAC; like
// the macOS Globe listener there is no event to subscribe to for "hook restored".
// Re-spawn on app focus so PTT recovers when the user comes back to the window.
function tryRecoverWindowsKeyListener(reason) {
  if (process.platform !== "win32") return;
  if (!windowsKeyManager || windowsKeyManager.process) return;

  const currentHotkey = hotkeyManager?.getCurrentHotkey?.();
  if (!currentHotkey) return;
  if (isGlobeLikeHotkeyForRecovery(currentHotkey)) return;

  const now = Date.now();
  if (now - lastWindowsRecoveryAttempt < WINDOWS_RECOVERY_MIN_INTERVAL_MS) return;
  lastWindowsRecoveryAttempt = now;

  debugLogger?.debug("[Win] Listener appears dead, attempting recovery", {
    reason,
    currentHotkey,
  });
  windowsKeyManager.start(currentHotkey);
}

function parseAuthBridgePort() {
  const raw = (
    process.env.MOUTHPIECE_AUTH_BRIDGE_PORT ||
    process.env.OPENWHISPR_AUTH_BRIDGE_PORT ||
    ""
  ).trim();
  if (!raw) return DEFAULT_AUTH_BRIDGE_PORT;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_AUTH_BRIDGE_PORT;
  }

  return parsed;
}

const AUTH_BRIDGE_HOST = "127.0.0.1";
const AUTH_BRIDGE_PORT = parseAuthBridgePort();
const AUTH_BRIDGE_PATH = "/oauth/callback";
// Set both new and legacy env vars for backward compatibility
process.env.MOUTHPIECE_AUTH_BRIDGE_URL =
  process.env.MOUTHPIECE_AUTH_BRIDGE_URL ||
  process.env.OPENWHISPR_AUTH_BRIDGE_URL ||
  `http://${AUTH_BRIDGE_HOST}:${AUTH_BRIDGE_PORT}${AUTH_BRIDGE_PATH}`;
process.env.OPENWHISPR_AUTH_BRIDGE_URL = process.env.MOUTHPIECE_AUTH_BRIDGE_URL;

// Set up PATH for production builds to find system tools (whisper.cpp, ffmpeg)
function setupProductionPath() {
  if (process.platform === "darwin" && process.env.NODE_ENV !== "development") {
    const commonPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
    ];

    const currentPath = process.env.PATH || "";
    const pathsToAdd = commonPaths.filter((p) => !currentPath.includes(p));

    if (pathsToAdd.length > 0) {
      process.env.PATH = `${currentPath}:${pathsToAdd.join(":")}`;
    }
  }
}

// Phase 1: Initialize managers + IPC handlers before window content loads
function initializeCoreManagers() {
  setupProductionPath();

  debugLogger = require("./src/helpers/debugLogger");
  debugLogger.ensureFileLogging();

  environmentManager = new EnvironmentManager();
  const uiLanguage = environmentManager.getUiLanguage();
  process.env.UI_LANGUAGE = uiLanguage;
  changeLanguage(uiLanguage);
  debugLogger.refreshLogLevel();

  windowManager = new WindowManager();
  hotkeyManager = windowManager.hotkeyManager;
  databaseManager = new DatabaseManager();
  clipboardManager = new ClipboardManager();
  whisperManager = new WhisperManager();
  if (process.platform !== "darwin") {
    whisperCudaManager = new WhisperCudaManager();
  }
  parakeetManager = new ParakeetManager();
  qwenAsrManager = new QwenAsrManager();
  updateManager = new UpdateManager({
    platform: process.platform,
    isPackaged: app.isPackaged,
    env: process.env,
    logger: debugLogger,
    beforeInstall: () => windowManager?.prepareForUpdateInstall?.(),
  });
  windowsKeyManager = new WindowsKeyManager();
  targetAppCapture = new TargetAppCapture();
  macOSPermissionFlowManager = new MacOSPermissionFlowManager({ logger: debugLogger });
  windowManager.targetAppCapture = targetAppCapture;

  // IPC handlers must be registered before window content loads
  ipcHandlersInstance = new IPCHandlers({
    environmentManager,
    databaseManager,
    clipboardManager,
    whisperManager,
    parakeetManager,
    qwenAsrManager,
    updateManager,
    windowManager,
    windowsKeyManager,
    targetAppCapture,
    whisperCudaManager,
    macOSPermissionFlowManager,
    getTrayManager: () => trayManager,
    getGlobeKeyManager: () => globeKeyManager,
  });
}

// Phase 2: Non-critical setup after windows are visible
function initializeDeferredManagers() {
  clipboardManager.preWarmAccessibility();
  trayManager = new TrayManager();
  globeKeyManager = new GlobeKeyManager();

  if (process.platform === "darwin") {
    globeKeyManager.on("error", (error) => {
      if (globeKeyAlertShown) {
        return;
      }
      globeKeyAlertShown = true;

      const detailLines = [
        error?.message || i18nMain.t("startup.globeHotkey.details.unknown"),
        i18nMain.t("startup.globeHotkey.details.fallback"),
      ];

      if (process.env.NODE_ENV === "development") {
        detailLines.push(i18nMain.t("startup.globeHotkey.details.devHint"));
      } else {
        detailLines.push(i18nMain.t("startup.globeHotkey.details.reinstallHint"));
      }

      dialog.showMessageBox({
        type: "warning",
        title: i18nMain.t("startup.globeHotkey.title"),
        message: i18nMain.t("startup.globeHotkey.message"),
        detail: detailLines.join("\n\n"),
      });
    });
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (!url.startsWith(`${OAUTH_PROTOCOL}://`)) return;

  // macOS delivers open-url before app.whenReady() during cold launch.
  // windowManager doesn't exist yet at that point, so handleOAuthDeepLink
  // would silently drop the verifier. Queue and flush after startApp finishes.
  if (!windowManager || !isLiveWindow(windowManager.controlPanelWindow)) {
    pendingOAuthDeepLinks.push(url);
    return;
  }

  handleOAuthDeepLink(url);

  if (isLiveWindow(windowManager.controlPanelWindow)) {
    windowManager.controlPanelWindow.show();
    windowManager.controlPanelWindow.focus();
  }
});

// Extract the session verifier from the deep link and navigate the control
// panel to its app URL with the verifier param so the Neon Auth SDK can
// read it from window.location.search and complete authentication.
function navigateControlPanelWithVerifier(verifier) {
  if (!verifier) return;
  if (!isLiveWindow(windowManager?.controlPanelWindow)) return;

  const appUrl = DevServerManager.getAppUrl(true);

  if (appUrl) {
    const separator = appUrl.includes("?") ? "&" : "?";
    const urlWithVerifier = `${appUrl}${separator}neon_auth_session_verifier=${encodeURIComponent(verifier)}`;
    windowManager.controlPanelWindow.loadURL(urlWithVerifier);
  } else {
    const fileInfo = DevServerManager.getAppFilePath(true);
    if (!fileInfo) return;
    fileInfo.query.neon_auth_session_verifier = verifier;
    windowManager.controlPanelWindow.loadFile(fileInfo.path, { query: fileInfo.query });
  }

  if (debugLogger) {
    debugLogger.debug("Navigating control panel with OAuth verifier", {
      appChannel: APP_CHANNEL,
      oauthProtocol: OAUTH_PROTOCOL,
    });
  }
  windowManager.controlPanelWindow.show();
  windowManager.controlPanelWindow.focus();
}

function handleOAuthDeepLink(deepLinkUrl) {
  try {
    const parsed = new URL(deepLinkUrl);
    const verifier = parsed.searchParams.get("neon_auth_session_verifier");
    if (!verifier) return;
    navigateControlPanelWithVerifier(verifier);
  } catch (err) {
    if (debugLogger) debugLogger.error("Failed to handle OAuth deep link:", err);
  }
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 32 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

function writeCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function startAuthBridgeServer() {
  if (APP_CHANNEL !== "development" || authBridgeServer) {
    return;
  }

  authBridgeServer = http.createServer(async (req, res) => {
    writeCorsHeaders(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const requestUrl = new URL(req.url || "/", `http://${AUTH_BRIDGE_HOST}:${AUTH_BRIDGE_PORT}`);
    if (requestUrl.pathname !== AUTH_BRIDGE_PATH) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    let verifier = requestUrl.searchParams.get("neon_auth_session_verifier");
    if (!verifier && req.method === "POST") {
      try {
        const body = await parseJsonBody(req);
        verifier = body?.neon_auth_session_verifier || body?.verifier || null;
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error.message || "Invalid request");
        return;
      }
    }

    if (!verifier) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Missing neon_auth_session_verifier");
      return;
    }

    navigateControlPanelWithVerifier(verifier);

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<html><body><h3>Mouthpiece sign-in complete.</h3><p>You can close this tab.</p></body></html>"
    );
  });

  authBridgeServer.on("error", (error) => {
    if (debugLogger) {
      debugLogger.error("OAuth auth bridge server failed:", error);
    }
  });

  // Track active sockets so will-quit can destroy them. http.Server.close()
  // alone only stops accepting new connections; existing keep-alive sockets
  // would otherwise keep the listener alive and stall app exit.
  authBridgeServer.on("connection", (socket) => {
    authBridgeSockets.add(socket);
    socket.on("close", () => authBridgeSockets.delete(socket));
  });

  authBridgeServer.listen(AUTH_BRIDGE_PORT, AUTH_BRIDGE_HOST, () => {
    if (debugLogger) {
      debugLogger.debug("OAuth auth bridge server started", {
        url: `http://${AUTH_BRIDGE_HOST}:${AUTH_BRIDGE_PORT}${AUTH_BRIDGE_PATH}`,
      });
    }
  });
}

// Main application startup
async function startApp() {
  // Phase 1: Core managers + IPC handlers before windows
  initializeCoreManagers();
  startAuthBridgeServer();
  const runtimeFingerprint = {
    marker: process.env.OPENWHISPR_SESSION_MARKER || "",
    pid: process.pid,
    channel: APP_CHANNEL,
    nodeEnv: process.env.NODE_ENV || "",
    appPath: app.getAppPath(),
    userDataPath: app.getPath("userData"),
  };
  try {
    const fingerprintPath = path.join(runtimeFingerprint.userDataPath, "runtime-fingerprint.json");
    const payload = {
      ...runtimeFingerprint,
      capturedAt: new Date().toISOString(),
    };
    fs.writeFileSync(fingerprintPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log("[RUNTIME_FINGERPRINT_FILE]", fingerprintPath);
  } catch (fingerprintError) {
    console.error(
      "[RUNTIME_FINGERPRINT_FILE] write failed",
      fingerprintError?.message || fingerprintError
    );
  }
  debugLogger?.info("[RUNTIME_FINGERPRINT]", runtimeFingerprint, "startup");
  console.log("[RUNTIME_FINGERPRINT]", JSON.stringify(runtimeFingerprint));

  // Electron's file:// sends no Origin header, which Neon Auth rejects.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ["https://*.neon.tech/*"] },
    (details, callback) => {
      try {
        details.requestHeaders["Origin"] = new URL(details.url).origin;
      } catch {
        /* malformed URL — leave Origin as-is */
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  if (process.platform === "darwin") {
    app.setActivationPolicy("regular");
  }

  // In development, wait for Vite dev server to be ready
  if (process.env.NODE_ENV === "development") {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Create windows FIRST so the user sees UI as soon as possible
  await windowManager.createMainWindow();
  await windowManager.createControlPanelWindow();

  // Phase 2: Initialize remaining managers after windows are visible
  initializeDeferredManagers();

  // Non-blocking server pre-warming
  const whisperSettings = {
    localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
    whisperModel: process.env.LOCAL_WHISPER_MODEL,
    useCuda: process.env.WHISPER_CUDA_ENABLED === "true" && whisperCudaManager?.isDownloaded(),
  };
  whisperManager.initializeAtStartup(whisperSettings).catch((err) => {
    debugLogger.debug("Whisper startup init error (non-fatal)", { error: err.message });
  });

  const parakeetSettings = {
    localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
    parakeetModel: process.env.PARAKEET_MODEL,
  };
  parakeetManager.initializeAtStartup(parakeetSettings).catch((err) => {
    debugLogger.debug("Parakeet startup init error (non-fatal)", { error: err.message });
  });

  const qwenAsrSettings = {
    localTranscriptionProvider: process.env.LOCAL_TRANSCRIPTION_PROVIDER || "",
    qwenAsrModel: process.env.QWEN_ASR_MODEL,
  };
  qwenAsrManager.initializeAtStartup(qwenAsrSettings).catch((err) => {
    debugLogger.debug("Qwen ASR startup init error (non-fatal)", { error: err.message });
  });

  if (process.env.REASONING_PROVIDER === "local" && process.env.LOCAL_REASONING_MODEL) {
    const modelManager = require("./src/helpers/modelManagerBridge").default;
    modelManager.prewarmServer(process.env.LOCAL_REASONING_MODEL).catch((err) => {
      debugLogger.debug("llama-server pre-warm error (non-fatal)", { error: err.message });
    });
  }

  if (process.platform === "win32") {
    const nircmdStatus = clipboardManager.getNircmdStatus();
    debugLogger.debug("Windows paste tool status", nircmdStatus);
  }

  trayManager.setWindows(windowManager.controlPanelWindow);
  trayManager.setWindowManager(windowManager);
  trayManager.setCreateControlPanelCallback(() => windowManager.createControlPanelWindow());
  await trayManager.createTray();
  updateManager.start();

  if (process.platform === "darwin") {
    const { isGlobeLikeHotkey } = require("./src/helpers/hotkeyManager");
    let globeLastStopTime = 0;
    const POST_STOP_COOLDOWN_MS = 300;
    const globeAutoSession = createAutomaticActivationSession({
      onShow: () => windowManager.showDictationPanel(),
      onTap: () => {
        if (isLiveWindow(windowManager.mainWindow)) {
          windowManager.mainWindow.webContents.send("toggle-dictation");
        }
      },
      onHoldStart: () => {
        debugLogger?.debug("[Globe] Starting dictation (automatic hold)");
        windowManager.sendStartDictation();
      },
      onHoldStop: () => {
        globeLastStopTime = Date.now();
        debugLogger?.debug("[Globe] Stopping dictation (automatic release)");
        windowManager.sendStopDictation();
      },
      onPendingCancel: () => windowManager.hideDictationPanel(),
    });

    globeKeyManager.on("globe-down", async () => {
      const currentHotkey = hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey();
      const mainWindowLive = isLiveWindow(windowManager.mainWindow);
      debugLogger?.debug("[Globe] globe-down received", {
        currentHotkey,
        mainWindowLive,
      });

      // Forward to control panel for hotkey capture
      if (isLiveWindow(windowManager.controlPanelWindow)) {
        windowManager.controlPanelWindow.webContents.send("globe-key-pressed");
      }

      // Handle dictation if Globe/Fn is the current hotkey
      if (isGlobeLikeHotkey(currentHotkey)) {
        if (mainWindowLive) {
          const now = Date.now();
          if (now - globeLastStopTime < POST_STOP_COOLDOWN_MS) {
            debugLogger?.debug("[Globe] Ignored — cooldown active");
            return;
          }
          if (targetAppCapture) targetAppCapture.captureTargetPid();
          globeAutoSession.keyDown();
        } else {
          debugLogger?.debug("[Globe] Ignored — mainWindow not live");
        }
      } else {
        debugLogger?.debug("[Globe] Ignored — hotkey is not GLOBE", { currentHotkey });
      }
    });

    globeKeyManager.on("globe-up", async () => {
      debugLogger?.debug("[Globe] globe-up received", globeAutoSession.getState());

      // Forward to control panel for hotkey capture (Fn key released)
      if (isLiveWindow(windowManager.controlPanelWindow)) {
        windowManager.controlPanelWindow.webContents.send("globe-key-released");
      }

      if (hotkeyManager.getCurrentHotkey && isGlobeLikeHotkey(hotkeyManager.getCurrentHotkey())) {
        globeAutoSession.keyUp();
      }

      // Fn release also stops compound push-to-talk for Fn+F-key hotkeys
      windowManager.handleMacPushModifierUp("fn");
    });

    globeKeyManager.on("modifier-up", (modifier) => {
      if (windowManager?.handleMacPushModifierUp) {
        windowManager.handleMacPushModifierUp(modifier);
      }
    });

    // Right-side single modifier handling (e.g., RightOption as hotkey)
    let rightModLastStopTime = 0;
    const rightModifierAutoSession = createAutomaticActivationSession({
      onShow: () => windowManager.showDictationPanel(),
      onTap: () => {
        if (isLiveWindow(windowManager.mainWindow)) {
          windowManager.mainWindow.webContents.send("toggle-dictation");
        }
      },
      onHoldStart: () => windowManager.sendStartDictation(),
      onHoldStop: () => {
        rightModLastStopTime = Date.now();
        windowManager.sendStopDictation();
      },
      onPendingCancel: () => windowManager.hideDictationPanel(),
    });

    globeKeyManager.on("right-modifier-down", async (modifier) => {
      const currentHotkey = hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey();
      if (currentHotkey !== modifier) return;
      if (!isLiveWindow(windowManager.mainWindow)) return;

      const now = Date.now();
      if (now - rightModLastStopTime < POST_STOP_COOLDOWN_MS) return;
      if (targetAppCapture) targetAppCapture.captureTargetPid();
      rightModifierAutoSession.keyDown();
    });

    globeKeyManager.on("right-modifier-up", async (modifier) => {
      const currentHotkey = hotkeyManager.getCurrentHotkey && hotkeyManager.getCurrentHotkey();

      if (currentHotkey === modifier) {
        if (!isLiveWindow(windowManager.mainWindow)) return;
        rightModifierAutoSession.keyUp();
      }

      const rightModToBase = {
        RightCommand: "command",
        RightOption: "option",
        RightControl: "control",
        RightShift: "shift",
      };
      const baseMod = rightModToBase[modifier];
      if (baseMod && windowManager?.handleMacPushModifierUp) {
        windowManager.handleMacPushModifierUp(baseMod);
      }
    });

    // P9.5 — Translation hotkey routed through the native key listener on
    // macOS. The Swift binary emits the full chord (e.g. "GLOBE+K" or
    // "RightCommand+T") on every keyDown; we match it against the stored
    // translation accelerator and, on a match, abort any in-flight main-hotkey
    // session (so the same Globe/Right-modifier press doesn't also fire the
    // dictation push-to-talk path) before forwarding the toggle to the
    // renderer.
    globeKeyManager.on("key-down-with-mods", (chord) => {
      const matches = !!currentTranslationAccelerator && chord === currentTranslationAccelerator;
      debugLogger?.debug?.("[TranslationHotkey] chord observed", {
        chord,
        storedAccelerator: currentTranslationAccelerator,
        matches,
        mainWindowLive: isLiveWindow(windowManager.mainWindow),
      });
      if (!matches) return;
      if (!isLiveWindow(windowManager.mainWindow)) return;

      const mainOutcome = globeAutoSession.abort();
      const rightOutcome = rightModifierAutoSession.abort();
      debugLogger?.debug("[Globe] translation chord matched", {
        chord,
        mainOutcome,
        rightOutcome,
      });

      if (windowManager?.sendToggleTranslationDictation) {
        windowManager.sendToggleTranslationDictation();
      }
    });

    // Wait for hotkeyManager to resolve the saved hotkey BEFORE spawning the
    // Globe listener. Otherwise the listener observes a ~1-second window where
    // currentHotkey is still the platform default ("GLOBE"), and Fn presses
    // there fire dictation even when the user has actually saved a different
    // hotkey — a startup-only false trigger.
    hotkeyManager.once("hotkey-ready", () => {
      debugLogger?.debug("[Globe] hotkey-ready received, starting native listener", {
        hotkey: hotkeyManager.getCurrentHotkey?.(),
      });
      globeKeyManager?.start();
    });

    // Reset native key state when hotkey changes. Subscribed via BOTH the
    // legacy renderer-driven IPC path AND the in-process hotkeyManager event,
    // so update-hotkey alone is enough — callers don't need to also fire
    // notifyHotkeyChanged for the listener to refresh.
    const handleMacHotkeyChanged = (newHotkey) => {
      globeAutoSession.abort();
      globeLastStopTime = 0;
      rightModifierAutoSession.abort();
      rightModLastStopTime = 0;

      if (globeKeyManager) {
        debugLogger?.debug("[Globe] Restarting native listener after hotkey change", {
          hotkey: newHotkey,
        });
        globeKeyManager.stop();
        if (globeKeyRestartTimer) {
          clearTimeout(globeKeyRestartTimer);
        }
        globeKeyRestartTimer = setTimeout(() => {
          globeKeyRestartTimer = null;
          globeKeyManager?.start();
        }, 100);
      }
    };
    ipcMain.on("hotkey-changed", (_event, newHotkey) => handleMacHotkeyChanged(newHotkey));
    hotkeyManager.on("hotkey-changed", handleMacHotkeyChanged);
  }

  // Set up Windows automatic activation handling
  if (process.platform === "win32") {
    debugLogger.debug("[Hotkey] Windows automatic activation setup starting");

    const { isGlobeLikeHotkey: isGlobeLike } = require("./src/helpers/hotkeyManager");
    const isValidHotkey = (hotkey) => hotkey && !isGlobeLike(hotkey);
    const needsNativeListener = (hotkey) => isValidHotkey(hotkey);

    windowsKeyManager.on("key-down", (_key) => {
      if (!isLiveWindow(windowManager.mainWindow)) return;

      windowManager.targetAppCapture?.captureTargetPid?.();
      windowManager.startWindowsPushToTalk();
    });

    windowsKeyManager.on("key-up", () => {
      if (!isLiveWindow(windowManager.mainWindow)) return;
      windowManager.handleWindowsPushKeyUp();
    });

    // P9.6 — Translation hotkey chord routed through the same native
    // listener path as the main push-to-talk key. Tap-to-toggle, so we only
    // care about KEY_DOWN. Abort any in-flight main-hotkey session first so
    // a Control-held → K-pressed sequence doesn't start both the main
    // dictation and the translation flow in parallel.
    windowsKeyManager.on("translation-key-down", () => {
      if (!isLiveWindow(windowManager.mainWindow)) return;
      windowManager.resetWindowsPushState?.();
      windowManager.sendToggleTranslationDictation?.();
    });

    windowsKeyManager.on("error", (error) => {
      windowManager.setWindowsNativeHotkeyEnabled(false);
      windowManager.resetWindowsPushState();
      debugLogger.warn("[Hotkey] Windows key listener error", { error: error.message });
      if (isLiveWindow(windowManager.mainWindow)) {
        windowManager.mainWindow.webContents.send("windows-ptt-unavailable", {
          reason: "error",
          message: error.message,
        });
      }
    });

    windowsKeyManager.on("unavailable", () => {
      windowManager.setWindowsNativeHotkeyEnabled(false);
      debugLogger.debug(
        "[Hotkey] Windows key listener not available - falling back to tap mode"
      );
      if (isLiveWindow(windowManager.mainWindow)) {
        windowManager.mainWindow.webContents.send("windows-ptt-unavailable", {
          reason: "binary_not_found",
          message: i18nMain.t("windows.pttUnavailable"),
        });
      }
    });

    windowsKeyManager.on("ready", () => {
      windowManager.setWindowsNativeHotkeyEnabled(true);
      debugLogger.debug("[Hotkey] WindowsKeyManager is ready for automatic hold detection");
    });

    const restartWindowsKeyListener = (hotkey = hotkeyManager.getCurrentHotkey()) => {
      windowManager.setWindowsNativeHotkeyEnabled(false);
      windowManager.resetWindowsPushState();
      windowsKeyManager.stop();

      if (!isLiveWindow(windowManager.mainWindow)) return;
      if (needsNativeListener(hotkey)) {
        windowsKeyManager.start(hotkey);
      }
    };

    // Drive initial listener bind off hotkey-ready instead of a 3-second wall
    // clock. On slow disks the 3s timer used to fire before the renderer's
    // localStorage read completed, binding the default hotkey instead of the
    // user's saved one.
    hotkeyManager.once("hotkey-ready", () => {
      restartWindowsKeyListener();
    });

    ipcMain.on("hotkey-changed", (_event, hotkey) => {
      restartWindowsKeyListener(hotkey);
    });
    hotkeyManager.on("hotkey-changed", (hotkey) => {
      restartWindowsKeyListener(hotkey);
    });

    app.on("before-quit", () => {
      windowManager.setWindowsNativeHotkeyEnabled(false);
      windowsKeyManager.stop();
    });
  }

  // All wiring is in place — let queued startup-dependent handlers proceed.
  flushPendingOAuthDeepLinks();
  resolveStartupReady();
}

// App event handlers
if (gotSingleInstanceLock) {
  app.on("second-instance", async (_event, commandLine) => {
    await app.whenReady();
    // Wait for startApp() to finish wiring windowManager / hotkeyManager so a
    // second launch arriving during the first ~300ms doesn't get silently dropped.
    await startupReadyPromise;
    if (!windowManager) {
      return;
    }

    if (isLiveWindow(windowManager.controlPanelWindow)) {
      if (windowManager.controlPanelWindow.isMinimized()) {
        windowManager.controlPanelWindow.restore();
      }
      windowManager.controlPanelWindow.show();
      windowManager.controlPanelWindow.focus();
      if (windowManager.controlPanelWindow.webContents.isCrashed()) {
        windowManager.loadControlPanel();
      }
    } else {
      windowManager.createControlPanelWindow();
    }

    if (isLiveWindow(windowManager.mainWindow)) {
      windowManager.enforceMainWindowOnTop();
    } else {
      windowManager.createMainWindow();
    }

    // Check for OAuth protocol URL in command line arguments (Windows)
    const url = commandLine.find((arg) => arg.startsWith(`${OAUTH_PROTOCOL}://`));
    if (url) {
      handleOAuthDeepLink(url);
    }
  });

  app.whenReady().then(() => {
    startApp().catch((error) => {
      console.error("Failed to start app:", error);
      dialog.showErrorBox(
        i18nMain.t("startup.error.title"),
        i18nMain.t("startup.error.message", { error: error.message })
      );
      app.exit(1);
    });
  });

  app.on("window-all-closed", () => {
    // Don't quit on macOS when all windows are closed
    // The app should stay in the dock/menu bar
    if (process.platform !== "darwin") {
      app.quit();
    }
    // On macOS, keep the app running even without windows
  });

  app.on("browser-window-focus", (_event, window) => {
    // Only apply always-on-top to the dictation window, not the control panel
    if (windowManager && isLiveWindow(windowManager.mainWindow)) {
      // Check if the focused window is the dictation window
      if (window === windowManager.mainWindow) {
        windowManager.enforceMainWindowOnTop();
      }
    }

    tryRecoverGlobeKeyListener("browser-window-focus");
    tryRecoverWindowsKeyListener("browser-window-focus");
  });

  app.on("activate", () => {
    // On macOS, re-create windows when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      if (windowManager) {
        windowManager.createMainWindow();
        windowManager.createControlPanelWindow();
      }
    } else {
      // Show control panel when dock icon is clicked (most common user action)
      if (windowManager && isLiveWindow(windowManager.controlPanelWindow)) {
        // Ensure dock icon is visible when control panel opens
        if (process.platform === "darwin" && app.dock) {
          app.dock.show();
        }
        if (windowManager.controlPanelWindow.isMinimized()) {
          windowManager.controlPanelWindow.restore();
        }
        windowManager.controlPanelWindow.show();
        windowManager.controlPanelWindow.focus();
      } else if (windowManager) {
        // If control panel doesn't exist, create it
        windowManager.createControlPanelWindow();
      }

      // Ensure dictation panel maintains its always-on-top status
      if (windowManager && isLiveWindow(windowManager.mainWindow)) {
        windowManager.enforceMainWindowOnTop();
      }
    }

    tryRecoverGlobeKeyListener("activate");
    tryRecoverWindowsKeyListener("activate");
  });

  let willQuitInProgress = false;
  app.on("will-quit", (event) => {
    if (willQuitInProgress) return;
    willQuitInProgress = true;
    event.preventDefault();

    // Synchronous teardown that has no I/O — safe to do up front.
    if (hotkeyManager) {
      hotkeyManager.unregisterAll();
    } else {
      globalShortcut.unregisterAll();
    }
    if (globeKeyManager) globeKeyManager.stop();
    if (windowsKeyManager) windowsKeyManager.stop();
    if (macOSPermissionFlowManager) macOSPermissionFlowManager.stop();
    if (updateManager) updateManager.dispose();

    // Drop in-flight HTTP sockets so authBridgeServer.close() doesn't hang on
    // keep-alive connections from a mid-flight OAuth callback.
    if (authBridgeServer) {
      for (const socket of authBridgeSockets) {
        try { socket.destroy(); } catch {}
      }
      authBridgeSockets.clear();
      try { authBridgeServer.closeAllConnections?.(); } catch {}
    }

    const shutdownTasks = [];
    const swallow = (label) => (err) =>
      debugLogger?.warn?.(`[will-quit] ${label} failed`, { error: err?.message });

    if (authBridgeServer) {
      shutdownTasks.push(
        new Promise((resolve) => {
          try {
            authBridgeServer.close(() => resolve());
          } catch {
            resolve();
          }
        })
      );
    }
    if (whisperManager) shutdownTasks.push(whisperManager.stopServer().catch(swallow("whisper")));
    if (parakeetManager) shutdownTasks.push(parakeetManager.stopServer().catch(swallow("parakeet")));
    if (qwenAsrManager) shutdownTasks.push(qwenAsrManager.stopServer().catch(swallow("qwenAsr")));
    try {
      const modelManager = require("./src/helpers/modelManagerBridge").default;
      shutdownTasks.push(modelManager.stopServer().catch(swallow("llama-server")));
    } catch {}

    // Streaming helpers each own a WebSocket / keep-alive interval. Without
    // disposing them here, a hard quit during an active session leaves the
    // sockets and timers around until the OS reaps the process.
    if (ipcHandlersInstance) {
      const streams = [
        ["assemblyAiStreaming", "cleanupAll"],
        ["deepgramStreaming", "cleanupAll"],
        ["sonioxStreaming", "disconnect"],
        ["bailianRealtimeStreaming", "disconnect"],
      ];
      for (const [prop, method] of streams) {
        const helper = ipcHandlersInstance[prop];
        if (!helper || typeof helper[method] !== "function") continue;
        try {
          const result = helper[method]();
          if (result && typeof result.catch === "function") {
            shutdownTasks.push(result.catch(swallow(prop)));
          }
        } catch (err) {
          swallow(prop)(err);
        }
      }
    }

    Promise.allSettled(shutdownTasks).finally(() => {
      authBridgeServer = null;
      app.exit(0);
    });
  });
}
