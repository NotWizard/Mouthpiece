const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");
const { spawn: childProcessSpawn } = require("child_process");

const HELPER_BINARY_NAME = "macos-permission-flow";

function isElectronBinaryExec(execPath = "") {
  const normalized = String(execPath || "").toLowerCase();
  return (
    normalized.includes("/electron.app/contents/macos/electron") ||
    normalized.endsWith("/electron") ||
    normalized.endsWith("\\electron.exe")
  );
}

function normalizeAppPath(candidate, fsExistsSync = fs.existsSync) {
  if (!candidate || typeof candidate !== "string") {
    return null;
  }

  const resolved = path.resolve(candidate);
  if (!resolved.toLowerCase().endsWith(".app")) {
    return null;
  }

  return fsExistsSync(resolved) ? resolved : null;
}

function findAncestorAppBundle(execPath = "", fsExistsSync = fs.existsSync) {
  let current = path.resolve(execPath || "/");

  while (current && current !== path.dirname(current)) {
    if (current.toLowerCase().endsWith(".app") && fsExistsSync(current)) {
      return current;
    }
    current = path.dirname(current);
  }

  return null;
}

function resolveMacOSAppBundlePath({
  platform = process.platform,
  defaultApp = process.defaultApp,
  env = process.env,
  execPath = process.execPath,
  fsExistsSync = fs.existsSync,
} = {}) {
  if (platform !== "darwin") return null;

  const override = normalizeAppPath(
    env?.MOUTHPIECE_PERMISSION_APP_PATH || env?.OPENWHISPR_PERMISSION_APP_PATH,
    fsExistsSync
  );
  if (override) return override;

  if (defaultApp || isElectronBinaryExec(execPath)) {
    return null;
  }

  return findAncestorAppBundle(execPath, fsExistsSync);
}

function resolvePermissionFlowBinary({
  platform = process.platform,
  resourcesPath = process.resourcesPath,
  fsExistsSync = fs.existsSync,
  binaryName = HELPER_BINARY_NAME,
} = {}) {
  if (platform !== "darwin") return null;

  const candidates = new Set([
    path.join(__dirname, "..", "..", "resources", "bin", binaryName),
    path.join(__dirname, "..", "..", "resources", binaryName),
  ]);

  if (resourcesPath) {
    [
      path.join(resourcesPath, binaryName),
      path.join(resourcesPath, "bin", binaryName),
      path.join(resourcesPath, "resources", binaryName),
      path.join(resourcesPath, "resources", "bin", binaryName),
      path.join(resourcesPath, "app.asar.unpacked", "resources", binaryName),
      path.join(resourcesPath, "app.asar.unpacked", "resources", "bin", binaryName),
    ].forEach((candidate) => candidates.add(candidate));
  }

  for (const candidate of candidates) {
    if (fsExistsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function sanitizeSourceFrame(frame) {
  if (!frame || typeof frame !== "object") return null;

  const values = ["x", "y", "width", "height"].map((key) => Number(frame[key]));
  if (values.some((value) => !Number.isFinite(value))) return null;

  const [x, y, width, height] = values;
  if (width <= 0 || height <= 0) return null;

  return { x, y, width, height };
}

function buildPermissionFlowArgs({ appPath, sourceFrame, title, instruction, doneLabel } = {}) {
  const args = ["--app", appPath];
  const cleanFrame = sanitizeSourceFrame(sourceFrame);

  if (cleanFrame) {
    args.push(
      "--source",
      String(cleanFrame.x),
      String(cleanFrame.y),
      String(cleanFrame.width),
      String(cleanFrame.height)
    );
  }

  if (title) args.push("--title", String(title));
  if (instruction) args.push("--instruction", String(instruction));
  if (doneLabel) args.push("--done-label", String(doneLabel));

  return args;
}

class MacOSPermissionFlowManager extends EventEmitter {
  constructor({
    platform = process.platform,
    defaultApp = process.defaultApp,
    env = process.env,
    execPath = process.execPath,
    resourcesPath = process.resourcesPath,
    fsExistsSync = fs.existsSync,
    spawn = childProcessSpawn,
    logger = null,
  } = {}) {
    super();
    this.platform = platform;
    this.defaultApp = defaultApp;
    this.env = env;
    this.execPath = execPath;
    this.resourcesPath = resourcesPath;
    this.fsExistsSync = fsExistsSync;
    this.spawn = spawn;
    this.logger = logger;
    this.process = null;
  }

  start(options = {}) {
    if (this.platform !== "darwin") {
      return { success: false, fallbackToSettings: false, reason: "unsupported-platform" };
    }

    if (this.process && !this.process.killed) {
      return { success: true, reused: true };
    }

    const appPath = resolveMacOSAppBundlePath({
      platform: this.platform,
      defaultApp: this.defaultApp,
      env: this.env,
      execPath: this.execPath,
      fsExistsSync: this.fsExistsSync,
    });
    if (!appPath) {
      return { success: false, fallbackToSettings: true, reason: "app-bundle-unavailable" };
    }

    const helperPath = resolvePermissionFlowBinary({
      platform: this.platform,
      resourcesPath: this.resourcesPath,
      fsExistsSync: this.fsExistsSync,
    });
    if (!helperPath) {
      return { success: false, fallbackToSettings: true, reason: "helper-unavailable" };
    }

    const args = buildPermissionFlowArgs({ ...options, appPath });

    try {
      const child = this.spawn(helperPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: this.env,
      });
      this.process = child;
      this._wireProcess(child);
      this.emit("event", { type: "started", appPath });
      return { success: true, appPath };
    } catch (error) {
      this.logger?.error?.("Failed to start macOS permission flow helper", {
        error: error.message,
      });
      return {
        success: false,
        fallbackToSettings: true,
        reason: "spawn-failed",
        error: error.message,
      };
    }
  }

  stop() {
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
    }
    this.process = null;
    return { success: true };
  }

  _wireProcess(child) {
    let stdoutBuffer = "";

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        this._handleOutputLine(line);
      }
    });

    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        this.logger?.warn?.("macOS permission flow helper stderr", { message });
      }
    });

    child.on("error", (error) => {
      this.emit("event", { type: "error", error: error.message });
    });

    child.on("exit", (code, signal) => {
      this.process = null;
      this.emit("event", { type: "closed", code, signal });
    });
  }

  _handleOutputLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) return;

    try {
      const payload = JSON.parse(trimmed);
      if (payload && typeof payload === "object") {
        this.emit("event", payload);
        return;
      }
    } catch {
      // Fall through to plain text event.
    }

    this.emit("event", { type: trimmed.toLowerCase() });
  }
}

module.exports = {
  HELPER_BINARY_NAME,
  MacOSPermissionFlowManager,
  buildPermissionFlowArgs,
  isElectronBinaryExec,
  resolveMacOSAppBundlePath,
  resolvePermissionFlowBinary,
  sanitizeSourceFrame,
};
