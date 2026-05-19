import { useState, useCallback, useEffect } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useLocalStorage } from "./useLocalStorage";

export interface UsePermissionsReturn {
  // State
  micPermissionGranted: boolean;
  accessibilityPermissionGranted: boolean;
  micPermissionError: string | null;

  requestMicPermission: () => Promise<void>;
  testAccessibilityPermission: () => Promise<void>;
  startAccessibilityPermissionFlow: () => Promise<void>;
  openMicPrivacySettings: () => Promise<void>;
  openSoundInputSettings: () => Promise<void>;
  openAccessibilitySettings: () => Promise<void>;
  resetAccessibilityPermissions: () => Promise<void>;
  setMicPermissionGranted: (granted: boolean) => void;
  setAccessibilityPermissionGranted: (granted: boolean) => void;
}

export interface UsePermissionsProps {
  showAlertDialog: (dialog: { title: string; description?: string }) => void;
}

const stopTracks = (stream?: MediaStream) => {
  try {
    stream?.getTracks?.().forEach((track) => track.stop());
  } catch {
    // ignore track cleanup errors
  }
};

const getPlatformSettingsPath = (t: TFunction): string => {
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) return t("hooks.permissions.paths.windowsMicrophone");
  }
  return t("hooks.permissions.paths.defaultSound");
};

const getPlatformPrivacyPath = (t: TFunction): string => {
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("win")) return t("hooks.permissions.paths.windowsMicrophone");
  }
  return t("hooks.permissions.paths.defaultPrivacy");
};

const getPlatform = (): "darwin" | "win32" => {
  if (typeof window !== "undefined" && window.electronAPI?.getPlatform) {
    const platform = window.electronAPI.getPlatform();
    if (platform === "darwin" || platform === "win32") {
      return platform;
    }
  }
  // Fallback to user agent detection
  if (typeof navigator !== "undefined") {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) return "darwin";
    if (ua.includes("win")) return "win32";
  }
  return "darwin"; // Default fallback
};

const describeMicError = (error: unknown, t: TFunction): string => {
  if (!error || typeof error !== "object") {
    return t("hooks.permissions.micErrors.accessFailed");
  }

  const err = error as { name?: string; message?: string };
  const name = err.name || "";
  const message = (err.message || "").toLowerCase();
  const settingsPath = getPlatformSettingsPath(t);
  const privacyPath = getPlatformPrivacyPath(t);

  if (name === "NotFoundError") {
    return t("hooks.permissions.micErrors.noMicrophones", { settingsPath });
  }

  if (name === "NotAllowedError" || name === "SecurityError") {
    return t("hooks.permissions.micErrors.permissionDenied", { privacyPath });
  }

  if (name === "NotReadableError" || name === "AbortError") {
    return t("hooks.permissions.micErrors.couldNotStart", { settingsPath });
  }

  if (message.includes("no audio input") || message.includes("not available")) {
    return t("hooks.permissions.micErrors.noActiveInput", { settingsPath });
  }

  return t("hooks.permissions.micErrors.unknown", {
    error: err.message || t("hooks.permissions.micErrors.unknownFallback"),
  });
};

export const usePermissions = (
  showAlertDialog?: UsePermissionsProps["showAlertDialog"]
): UsePermissionsReturn => {
  const { t } = useTranslation();
  const [micPermissionGranted, setMicPermissionGranted] = useLocalStorage(
    "micPermissionGranted",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    }
  );
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [accessibilityPermissionGranted, setAccessibilityPermissionGranted] = useLocalStorage(
    "accessibilityPermissionGranted",
    false,
    {
      serialize: String,
      deserialize: (value) => value === "true",
    }
  );
  const openSystemSettings = useCallback(
    async (
      settingType: "microphone" | "sound" | "accessibility",
      apiMethod: () => Promise<{ success: boolean; error?: string } | undefined> | undefined
    ) => {
      const titles = {
        microphone: t("hooks.permissions.settingsTitles.microphone"),
        sound: t("hooks.permissions.settingsTitles.sound"),
        accessibility: t("hooks.permissions.settingsTitles.accessibility"),
      };
      const unableToOpenDescriptions = {
        microphone: t("hooks.permissions.settingsErrors.unableToOpenMicrophone"),
        sound: t("hooks.permissions.settingsErrors.unableToOpenSound"),
        accessibility: t("hooks.permissions.settingsErrors.unableToOpenAccessibility"),
      };
      try {
        const result = await apiMethod?.();
        if (result && !result.success && result.error) {
          showAlertDialog?.({ title: titles[settingType], description: result.error });
        }
      } catch (error) {
        console.error(`Failed to open ${settingType} settings:`, error);
        showAlertDialog?.({
          title: titles[settingType],
          description: unableToOpenDescriptions[settingType],
        });
      }
    },
    [showAlertDialog, t]
  );

  const openMicPrivacySettings = useCallback(
    () => openSystemSettings("microphone", window.electronAPI?.openMicrophoneSettings),
    [openSystemSettings]
  );

  const openSoundInputSettings = useCallback(
    () => openSystemSettings("sound", window.electronAPI?.openSoundInputSettings),
    [openSystemSettings]
  );

  const openAccessibilitySettings = useCallback(
    () => openSystemSettings("accessibility", window.electronAPI?.openAccessibilitySettings),
    [openSystemSettings]
  );

  const syncAccessibilityPermission = useCallback(async (): Promise<boolean> => {
    if (getPlatform() !== "darwin") {
      return true;
    }

    try {
      const granted = await window.electronAPI?.checkAccessibilityPermission?.({
        promptOnFailure: false,
        bypassCache: true,
      });
      setAccessibilityPermissionGranted(Boolean(granted));
      return Boolean(granted);
    } catch (error) {
      console.error("Failed to refresh accessibility permission:", error);
      return false;
    }
  }, [setAccessibilityPermissionGranted]);

  const resetAccessibilityPermissions = useCallback(async () => {
    if (getPlatform() !== "darwin") {
      return;
    }

    try {
      const result = await window.electronAPI?.resetAccessibilityPermissions?.();
      if (result && !result.success) {
        showAlertDialog?.({
          title: t("settingsPage.permissions.resetAccessibility.title"),
          description:
            result.error || t("settingsPage.permissions.resetAccessibility.description"),
        });
        return;
      }

      setAccessibilityPermissionGranted(false);
    } catch (error) {
      console.error("Failed to reset accessibility permission:", error);
      showAlertDialog?.({
        title: t("settingsPage.permissions.resetAccessibility.title"),
        description: t("settingsPage.permissions.resetAccessibility.description"),
      });
    }
  }, [setAccessibilityPermissionGranted, showAlertDialog, t]);

  const waitForAccessibilityPermission = useCallback(async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const granted = await syncAccessibilityPermission();
      if (granted) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return false;
  }, [syncAccessibilityPermission]);

  const startAccessibilityPermissionFlow = useCallback(async () => {
    if (getPlatform() !== "darwin") {
      setAccessibilityPermissionGranted(true);
      return;
    }

    try {
      const result = await window.electronAPI?.startAccessibilityPermissionFlow?.();

      if (!result?.success && !result?.fallbackOpened) {
        await openAccessibilitySettings();
      }

      const granted = await waitForAccessibilityPermission();
      if (granted) {
        await window.electronAPI?.stopAccessibilityPermissionFlow?.().catch(() => undefined);
        return;
      }

      showAlertDialog?.({
        title: t("hooks.permissions.permissionFlow.fallbackTitle"),
        description: t("hooks.permissions.permissionFlow.fallbackDescription"),
      });
    } catch (error) {
      console.error("Failed to start accessibility permission flow:", error);
      await openAccessibilitySettings();
      showAlertDialog?.({
        title: t("hooks.permissions.titles.accessibilityNeeded"),
        description: t("hooks.permissions.descriptions.accessibilityNeeded"),
      });
    }
  }, [
    openAccessibilitySettings,
    setAccessibilityPermissionGranted,
    showAlertDialog,
    t,
    waitForAccessibilityPermission,
  ]);

  const requestMicPermission = useCallback(async () => {
    if (!navigator?.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      const message = t("hooks.permissions.micUnavailable");
      setMicPermissionError(message);
      if (showAlertDialog) {
        showAlertDialog({
          title: t("hooks.permissions.titles.microphoneUnavailable"),
          description: message,
        });
      } else {
        alert(message);
      }
      return;
    }

    setMicPermissionError(null);

    try {
      // macOS hardened runtime requires main-process mic prompt before getUserMedia works
      if (window.electronAPI?.requestMicrophoneAccess) {
        try {
          await window.electronAPI.requestMicrophoneAccess();
        } catch {
          // ignored — getUserMedia below will surface the error
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopTracks(stream);
      setMicPermissionGranted(true);
      setMicPermissionError(null);
    } catch (err) {
      console.error("Microphone permission denied:", err);
      const message = describeMicError(err, t);
      setMicPermissionError(message);
      if (showAlertDialog) {
        showAlertDialog({
          title: t("hooks.permissions.titles.microphonePermissionRequired"),
          description: message,
        });
      } else {
        alert(message);
      }
    }
  }, [setMicPermissionGranted, showAlertDialog, t]);

  useEffect(() => {
    if (getPlatform() !== "darwin") return;

    void syncAccessibilityPermission();

    const refreshAccessibilityPermission = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      void syncAccessibilityPermission();
    };

    window.addEventListener("focus", refreshAccessibilityPermission);
    document.addEventListener("visibilitychange", refreshAccessibilityPermission);

    return () => {
      window.removeEventListener("focus", refreshAccessibilityPermission);
      document.removeEventListener("visibilitychange", refreshAccessibilityPermission);
    };
  }, [syncAccessibilityPermission]);

  const testAccessibilityPermission = useCallback(async () => {
    const platform = getPlatform();

    // On macOS, actually test the accessibility permission
    if (platform === "darwin") {
      try {
        const result = await window.electronAPI.pasteText(
          t("hooks.permissions.accessibilityTestText"),
          { suppressDictationPanelRestore: true }
        );
        if (result?.mode !== "pasted") {
          throw new Error(result?.message || "Automatic paste unavailable");
        }
        setAccessibilityPermissionGranted(true);
      } catch (err) {
        console.error("Accessibility permission test failed:", err);
        setAccessibilityPermissionGranted(false);
        if (showAlertDialog) {
          showAlertDialog({
            title: t("hooks.permissions.titles.accessibilityNeeded"),
            description: t("hooks.permissions.descriptions.accessibilityNeeded"),
          });
        } else {
          alert(t("hooks.permissions.alerts.accessibilityNeeded"));
        }
      }
      return;
    }

    // On Windows, PowerShell SendKeys is always available
    if (platform === "win32") {
      setAccessibilityPermissionGranted(true);
      if (showAlertDialog) {
        showAlertDialog({
          title: t("hooks.permissions.titles.readyToGo"),
          description: t("hooks.permissions.descriptions.windowsReady"),
        });
      }
      return;
    }
  }, [showAlertDialog, setAccessibilityPermissionGranted, t]);

  return {
    micPermissionGranted,
    accessibilityPermissionGranted,
    micPermissionError,
    requestMicPermission,
    testAccessibilityPermission,
    startAccessibilityPermissionFlow,
    openMicPrivacySettings,
    openSoundInputSettings,
    openAccessibilitySettings,
    resetAccessibilityPermissions,
    setMicPermissionGranted,
    setAccessibilityPermissionGranted,
  };
};
