/**
 * WindowsKeyManager - Handles key up/down detection for Push-to-Talk on Windows
 *
 * Uses a native Windows keyboard hook to detect when specific keys are
 * pressed and released, enabling Push-to-Talk functionality.
 */

const { spawn } = require("child_process");
const path = require("path");
const EventEmitter = require("events");
const fs = require("fs");
const debugLogger = require("./debugLogger");

class WindowsKeyManager extends EventEmitter {
  constructor() {
    super();
    this.process = null;
    this.isSupported = process.platform === "win32";
    this.hasReportedError = false;
    this.currentKey = null;
    this.isReady = false;
    this._isStopping = false;
    // P9.6 — a second listener child process dedicated to the translation
    // hotkey chord (e.g. "Control+K"). Kept separate from the main push-to-
    // talk listener above because the main listener's state machine assumes
    // a single key with KEY_DOWN/KEY_UP semantics while the translation
    // chord is tap-to-toggle and only cares about KEY_DOWN.
    this._translationProcess = null;
    this._translationKey = null;
    this._isStoppingTranslation = false;
  }

  /**
   * Start listening for the specified key
   * @param {string} key - The key to listen for (e.g., "`", "F8", "F11", "CommandOrControl+F11")
   */
  start(key = "`") {
    if (!this.isSupported) {
      return;
    }

    // If already running with the same key, do nothing
    if (this.process && this.currentKey === key) {
      return;
    }

    // Stop any existing listener
    this.stop();

    const listenerPath = this.resolveListenerBinary();
    if (!listenerPath) {
      // Binary not found - this is OK, Push-to-Talk will use fallback mode
      this.emit("unavailable", new Error("Windows key listener binary not found"));
      return;
    }

    this._isStopping = false;
    this.hasReportedError = false;
    this.isReady = false;
    this.currentKey = key;

    debugLogger.debug("[WindowsKeyManager] Starting key listener", {
      key,
      binaryPath: listenerPath,
    });

    let child;
    try {
      child = spawn(listenerPath, [key], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      debugLogger.error("[WindowsKeyManager] Failed to spawn process", { error: error.message });
      this.reportError(error);
      return;
    }
    this.process = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (this.process !== child) return;
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (line === "READY") {
            debugLogger.debug("[WindowsKeyManager] Listener ready", { key });
            this.isReady = true;
            this.emit("ready");
          } else if (line === "KEY_DOWN") {
            debugLogger.debug("[WindowsKeyManager] KEY_DOWN detected", { key });
            this.emit("key-down", key);
          } else if (line === "KEY_UP") {
            debugLogger.debug("[WindowsKeyManager] KEY_UP detected", { key });
            this.emit("key-up", key);
          } else {
            // Log unknown output at debug level (could be native binary's stderr info)
            debugLogger.debug("[WindowsKeyManager] Unknown output", { line });
          }
        });
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data) => {
      if (this.process !== child) return;
      const message = data.toString().trim();
      if (message.length > 0) {
        // Native binary logs to stderr for info messages, don't treat as error
        debugLogger.debug("[WindowsKeyManager] Native stderr", { message });
      }
    });

    child.on("error", (error) => {
      if (this.process !== child) return;
      this.reportError(error);
      this.process = null;
    });

    child.on("exit", (code, signal) => {
      // Identity check: if a newer child has replaced this one, the OLD process's
      // async exit must not poison the NEW process's state — reportError would
      // otherwise emit 'error' and disable the just-spawned listener.
      if (this.process !== child) return;
      this.process = null;
      this.isReady = false;
      if (this._isStopping) return;
      if (code !== 0) {
        const error = new Error(
          `Windows key listener exited with code ${code ?? "null"} signal ${signal ?? "null"}`
        );
        this.reportError(error);
      }
    });
  }

  /**
   * Stop the key listener
   */
  stop() {
    if (this.process) {
      debugLogger.debug("[WindowsKeyManager] Stopping key listener");
      this._isStopping = true;
      try {
        this.process.kill();
      } catch {
        // Ignore kill errors
      }
      this.process = null;
    }
    this.isReady = false;
    this.currentKey = null;
  }

  /**
   * Start listening for the translation hotkey chord (e.g. "Control+K").
   * Spawns a second native listener child process whose only job is to emit a
   * "translation-key-down" event when the chord fires. Tap-to-toggle, so we
   * ignore the binary's KEY_UP lines on this channel.
   *
   * @param {string} key - The chord to listen for (Electron accelerator format)
   */
  startTranslation(key) {
    if (!this.isSupported) return;
    if (!key || typeof key !== "string") return;

    if (this._translationProcess && this._translationKey === key) {
      return; // idempotent
    }

    this.stopTranslation();

    const listenerPath = this.resolveListenerBinary();
    if (!listenerPath) {
      // No binary — the translation hotkey just doesn't work on this install.
      // Don't escalate; main push-to-talk has its own unavailable path.
      return;
    }

    this._isStoppingTranslation = false;
    this._translationKey = key;

    debugLogger.debug("[WindowsKeyManager] Starting translation listener", { key });

    let child;
    try {
      child = spawn(listenerPath, [key], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      debugLogger.warn("[WindowsKeyManager] Failed to spawn translation listener", {
        error: error.message,
      });
      return;
    }
    this._translationProcess = child;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (this._translationProcess !== child) return;
      chunk
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .forEach((line) => {
          if (line === "KEY_DOWN") {
            debugLogger.debug("[WindowsKeyManager] translation KEY_DOWN", { key });
            this.emit("translation-key-down", key);
          }
          // KEY_UP and READY intentionally ignored — translation is tap-to-toggle.
        });
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (data) => {
      if (this._translationProcess !== child) return;
      const message = data.toString().trim();
      if (message.length > 0) {
        debugLogger.debug("[WindowsKeyManager] translation stderr", { message });
      }
    });

    child.on("error", (error) => {
      if (this._translationProcess !== child) return;
      debugLogger.warn("[WindowsKeyManager] translation listener error", {
        error: error.message,
      });
      this._translationProcess = null;
    });

    child.on("exit", (code, signal) => {
      if (this._translationProcess !== child) return;
      this._translationProcess = null;
      if (this._isStoppingTranslation) return;
      if (code !== 0) {
        debugLogger.warn("[WindowsKeyManager] translation listener exited unexpectedly", {
          code,
          signal,
        });
      }
    });
  }

  /**
   * Stop the translation hotkey listener (if any).
   */
  stopTranslation() {
    if (this._translationProcess) {
      debugLogger.debug("[WindowsKeyManager] Stopping translation listener");
      this._isStoppingTranslation = true;
      try {
        this._translationProcess.kill();
      } catch {
        // Ignore
      }
      this._translationProcess = null;
    }
    this._translationKey = null;
  }

  /**
   * Check if the listener is available and ready
   */
  isAvailable() {
    return this.resolveListenerBinary() !== null;
  }

  /**
   * Report an error (only once per session to avoid log spam)
   */
  reportError(error) {
    if (this.hasReportedError) {
      return;
    }
    this.hasReportedError = true;

    if (this.process) {
      try {
        this.process.kill();
      } catch {
        // Ignore
      } finally {
        this.process = null;
      }
    }

    debugLogger.warn("[WindowsKeyManager] Error occurred", { error: error.message });
    this.emit("error", error);
  }

  /**
   * Find the listener binary in various possible locations
   */
  resolveListenerBinary() {
    const binaryName = "windows-key-listener.exe";
    const candidates = new Set([
      path.join(__dirname, "..", "..", "resources", "bin", binaryName),
      path.join(__dirname, "..", "..", "resources", binaryName),
    ]);

    if (process.resourcesPath) {
      [
        path.join(process.resourcesPath, binaryName),
        path.join(process.resourcesPath, "bin", binaryName),
        path.join(process.resourcesPath, "resources", binaryName),
        path.join(process.resourcesPath, "resources", "bin", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", binaryName),
        path.join(process.resourcesPath, "app.asar.unpacked", "resources", "bin", binaryName),
      ].forEach((candidate) => candidates.add(candidate));
    }

    const candidatePaths = [...candidates];

    for (const candidate of candidatePaths) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}

module.exports = WindowsKeyManager;
