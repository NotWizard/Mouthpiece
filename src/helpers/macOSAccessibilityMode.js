function isElectronBinaryExec(execPath = process.execPath || "") {
  const normalizedExecPath = String(execPath || "").toLowerCase();
  return (
    normalizedExecPath.includes("/electron.app/contents/macos/electron") ||
    normalizedExecPath.endsWith("/electron") ||
    normalizedExecPath.endsWith("\\electron.exe")
  );
}

function inferIsPackagedRuntime({
  defaultApp = process.defaultApp,
  execPath = process.execPath,
  resourcesPath = process.resourcesPath,
} = {}) {
  if (defaultApp || isElectronBinaryExec(execPath)) {
    return false;
  }

  return Boolean(resourcesPath);
}

function parseNativeHelperOverride(rawValue) {
  const normalizedValue = String(rawValue || "")
    .trim()
    .toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  if (["1", "true", "yes", "on", "native"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "off", "osascript", "apple-script", "polling"].includes(normalizedValue)) {
    return false;
  }

  return null;
}

function resolveMacOSAccessibilityMode({
  platform = process.platform,
  isPackaged = inferIsPackagedRuntime(),
  env = process.env,
} = {}) {
  if (platform !== "darwin") {
    return {
      useNativePasteHelper: true,
      useNativeTextMonitor: true,
      reason: "non-macos",
    };
  }

  const override = parseNativeHelperOverride(
    env?.MOUTHPIECE_MACOS_NATIVE_AX_HELPERS ?? env?.OPENWHISPR_MACOS_NATIVE_AX_HELPERS
  );

  if (override === true) {
    return {
      useNativePasteHelper: true,
      useNativeTextMonitor: true,
      reason: "env-forced-native",
    };
  }

  if (override === false) {
    return {
      useNativePasteHelper: false,
      useNativeTextMonitor: false,
      reason: "env-forced-apple-script",
    };
  }

  if (isPackaged) {
    return {
      useNativePasteHelper: false,
      useNativeTextMonitor: false,
      reason: "packaged-default-apple-script",
    };
  }

  return {
    useNativePasteHelper: true,
    useNativeTextMonitor: true,
    reason: "development-default-native",
  };
}

module.exports = {
  inferIsPackagedRuntime,
  isElectronBinaryExec,
  parseNativeHelperOverride,
  resolveMacOSAccessibilityMode,
};
