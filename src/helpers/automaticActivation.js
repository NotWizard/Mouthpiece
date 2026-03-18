const HotkeyManager = require("./hotkeyManager");

const { isGlobeLikeHotkey, isRightSideModifier } = HotkeyManager;

const AUTOMATIC_ACTIVATION_THRESHOLD_MS = 150;

function getAutomaticActivationSupport({
  platform = process.platform,
  hotkey,
  isUsingGnome = false,
  windowsListenerAvailable = true,
} = {}) {
  if (!hotkey || typeof hotkey !== "string") {
    return {
      supportsHold: false,
      mode: "tap-only",
      reason: "missing-hotkey",
    };
  }

  if (isUsingGnome) {
    return {
      supportsHold: false,
      mode: "tap-only",
      reason: "gnome-shortcut",
    };
  }

  if (platform === "win32") {
    if (windowsListenerAvailable) {
      return {
        supportsHold: true,
        mode: "automatic",
        reason: "native-key-up",
      };
    }

    return {
      supportsHold: false,
      mode: "tap-only",
      reason: "windows-listener-unavailable",
    };
  }

  if (platform === "darwin") {
    if (isGlobeLikeHotkey(hotkey) || isRightSideModifier(hotkey) || hotkey.includes("+")) {
      return {
        supportsHold: true,
        mode: "automatic",
        reason: "native-key-up",
      };
    }
  }

  return {
    supportsHold: false,
    mode: "tap-only",
    reason: "shortcut-without-key-up",
  };
}

function createAutomaticActivationSession({
  thresholdMs = AUTOMATIC_ACTIVATION_THRESHOLD_MS,
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = (timerId) => clearTimeout(timerId),
  onShow = () => {},
  onTap = () => {},
  onHoldStart = () => {},
  onHoldStop = () => {},
  onPendingCancel = () => {},
} = {}) {
  let active = false;
  let holdStarted = false;
  let holdTimerId = null;

  const clearHoldTimer = () => {
    if (holdTimerId !== null) {
      cancel(holdTimerId);
      holdTimerId = null;
    }
  };

  return {
    keyDown() {
      if (active) {
        return false;
      }

      active = true;
      holdStarted = false;
      onShow();

      holdTimerId = schedule(() => {
        if (!active || holdStarted) {
          return;
        }

        holdTimerId = null;
        holdStarted = true;
        onHoldStart();
      }, thresholdMs);

      return true;
    },

    keyUp() {
      if (!active) {
        return "idle";
      }

      clearHoldTimer();

      if (holdStarted) {
        active = false;
        holdStarted = false;
        onHoldStop();
        return "hold";
      }

      active = false;
      onTap();
      return "tap";
    },

    abort() {
      if (!active) {
        return "idle";
      }

      clearHoldTimer();

      if (holdStarted) {
        active = false;
        holdStarted = false;
        onHoldStop();
        return "hold";
      }

      active = false;
      onPendingCancel();
      return "pending";
    },

    cancel() {
      if (!active) {
        return "idle";
      }

      const outcome = holdStarted ? "hold" : "pending";
      clearHoldTimer();
      active = false;
      holdStarted = false;
      return outcome;
    },

    getState() {
      return {
        active,
        holdStarted,
      };
    },
  };
}

module.exports = {
  AUTOMATIC_ACTIVATION_THRESHOLD_MS,
  createAutomaticActivationSession,
  getAutomaticActivationSupport,
};
