const { EventEmitter } = require("events");

const DEFAULT_UPDATE_INTERVAL_MS = 12 * 60 * 60 * 1000;

function getDefaultAutoUpdater() {
  const electronUpdater = require("electron-updater");
  return electronUpdater.autoUpdater;
}

function normalizeUpdateInfo(info) {
  if (!info) {
    return null;
  }

  return {
    version: typeof info.version === "string" ? info.version : null,
    releaseName: typeof info.releaseName === "string" ? info.releaseName : null,
    releaseNotes: info.releaseNotes ?? null,
  };
}

class UpdateManager extends EventEmitter {
  constructor({
    autoUpdater = null,
    platform = process.platform,
    isPackaged = false,
    env = process.env,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    intervalMs = DEFAULT_UPDATE_INTERVAL_MS,
    logger = console,
  } = {}) {
    super();
    this.autoUpdater = autoUpdater || getDefaultAutoUpdater();
    this.platform = platform;
    this.isPackaged = Boolean(isPackaged);
    this.env = env || {};
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.pollTimer = null;
    this.started = false;
    this.checkInFlight = null;
    this.listenersBound = false;
    this.state = {
      status: "idle",
      supported: false,
      checkingEnabled: false,
      updateInfo: null,
      error: null,
      progressPercent: null,
    };
  }

  isSupported() {
    if (!this.isPackaged) {
      return false;
    }

    if (this.platform === "darwin") {
      return true;
    }

    if (this.platform === "win32") {
      return !this.env.PORTABLE_EXECUTABLE_FILE;
    }

    if (this.platform === "linux") {
      return Boolean(this.env.APPIMAGE);
    }

    return false;
  }

  getStatus() {
    return { ...this.state };
  }

  async start() {
    if (this.started) {
      return this.state.supported;
    }

    this.started = true;

    if (!this.isSupported()) {
      this._setStatus({
        status: "unsupported",
        supported: false,
        checkingEnabled: false,
      });
      return false;
    }

    this._bindListeners();
    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = false;
    this._setStatus({
      supported: true,
      checkingEnabled: true,
      error: null,
    });

    await this.checkForUpdates();
    this.pollTimer = this.setIntervalFn(() => {
      void this.checkForUpdates();
    }, this.intervalMs);

    return true;
  }

  async checkForUpdates() {
    if (!this.state.supported) {
      return false;
    }

    if (this.checkInFlight) {
      return this.checkInFlight;
    }

    this._setStatus({
      status: "checking",
      error: null,
    });

    this.checkInFlight = Promise.resolve()
      .then(() => this.autoUpdater.checkForUpdates())
      .catch((error) => {
        this._handleError(error);
        return null;
      })
      .finally(() => {
        if (this.state.status === "checking") {
          this._setStatus({
            status: "idle",
          });
        }
        this.checkInFlight = null;
      });

    return this.checkInFlight;
  }

  async installUpdate() {
    if (this.state.status !== "downloaded") {
      return {
        success: false,
        error: "No downloaded update is ready to install.",
      };
    }

    try {
      this._setStatus({
        status: "installing",
      });
      this.autoUpdater.quitAndInstall();
      return { success: true };
    } catch (error) {
      this._handleError(error);
      return {
        success: false,
        error: error?.message || "Failed to install update.",
      };
    }
  }

  dispose() {
    if (this.pollTimer) {
      this.clearIntervalFn(this.pollTimer);
      this.pollTimer = null;
    }
  }

  _bindListeners() {
    if (this.listenersBound) {
      return;
    }

    this.listenersBound = true;

    this.autoUpdater.on("checking-for-update", () => {
      this._setStatus({
        status: "checking",
        error: null,
      });
    });

    this.autoUpdater.on("update-available", (info) => {
      this._setStatus({
        status: "downloading",
        updateInfo: normalizeUpdateInfo(info),
        error: null,
        progressPercent: null,
      });
    });

    this.autoUpdater.on("download-progress", (progress) => {
      this._setStatus({
        status: "downloading",
        progressPercent:
          typeof progress?.percent === "number"
            ? Math.round(progress.percent)
            : this.state.progressPercent,
      });
    });

    this.autoUpdater.on("update-downloaded", (info) => {
      this._setStatus({
        status: "downloaded",
        updateInfo: normalizeUpdateInfo(info),
        error: null,
        progressPercent: 100,
      });
    });

    this.autoUpdater.on("update-not-available", () => {
      this._setStatus({
        status: "idle",
        updateInfo: null,
        error: null,
        progressPercent: null,
      });
    });

    this.autoUpdater.on("error", (error) => {
      this._handleError(error);
    });
  }

  _handleError(error) {
    const message = error?.message || "Unknown update error";
    if (typeof this.logger?.error === "function") {
      this.logger.error("[UpdateManager] Auto-update error:", message);
    }
    this._setStatus({
      status: "error",
      error: message,
      progressPercent: null,
    });
  }

  _setStatus(nextState) {
    this.state = {
      ...this.state,
      ...nextState,
    };
    this.emit("status-changed", this.getStatus());
  }
}

module.exports = UpdateManager;
module.exports.DEFAULT_UPDATE_INTERVAL_MS = DEFAULT_UPDATE_INTERVAL_MS;
