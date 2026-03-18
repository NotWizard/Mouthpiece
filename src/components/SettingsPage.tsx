import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import {
  Command,
  Mic,
  Shield,
  FolderOpen,
  Sun,
  Moon,
  Monitor,
  Key,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { NEON_AUTH_URL } from "../lib/neonAuth";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import MicrophoneSettings from "./ui/MicrophoneSettings";
import PermissionCard from "./ui/PermissionCard";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import TranscriptionModelPicker from "./TranscriptionModelPicker";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useSettings } from "../hooks/useSettings";
import { useDialogs } from "../hooks/useDialogs";
import { useWhisper } from "../hooks/useWhisper";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";

import PromptStudio from "./ui/PromptStudio";
import ReasoningModelSelector from "./ReasoningModelSelector";
import { HotkeyInput } from "./ui/HotkeyInput";
import HotkeyGuidanceAccordion from "./ui/HotkeyGuidanceAccordion";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { getValidationMessage } from "../utils/hotkeyValidator";
import { getPlatform, getCachedPlatform } from "../utils/platform";
import { getDefaultHotkey, formatHotkeyLabel } from "../utils/hotkeys";
import { Toggle } from "./ui/toggle";
import DeveloperSection from "./DeveloperSection";
import LanguageSelector from "./ui/LanguageSelector";
import { useToast } from "./ui/Toast";
import { useTheme } from "../hooks/useTheme";
import type { LocalTranscriptionProvider } from "../types/electron";
import logger from "../utils/logger";
import { SettingsRow } from "./ui/SettingsSection";
import { cn } from "./lib/utils";
import { UI_LANGUAGE_OPTIONS } from "../locales/localeManifest";
import { CURRENT_CACHE_DIRNAME } from "../config/productIdentity";
import modelCachePaths from "../utils/modelCachePaths";

export type SettingsSectionType =
  | "general"
  | "hotkeys"
  | "transcription"
  | "intelligence"
  | "privacyData"
  | "system"
  | "aiModels"
  | "prompts";

interface SettingsPageProps {
  activeSection?: SettingsSectionType;
}

function SettingsPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-border/50 dark:border-border-subtle/70 bg-card/50 dark:bg-surface-2/50 backdrop-blur-sm divide-y divide-border/30 dark:divide-border-subtle/50 ${className}`}
    >
      {children}
    </div>
  );
}

function SettingsPanelRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-xs font-semibold text-foreground tracking-tight">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground/80 mt-0.5 leading-relaxed">{description}</p>
      )}
    </div>
  );
}

interface TranscriptionSectionProps {
  isSignedIn: boolean;
  cloudAuthAvailable: boolean;
  cloudTranscriptionMode: string;
  setCloudTranscriptionMode: (mode: string) => void;
  useLocalWhisper: boolean;
  setUseLocalWhisper: (value: boolean) => void;
  updateTranscriptionSettings: (settings: { useLocalWhisper: boolean }) => void;
  cloudTranscriptionProvider: string;
  setCloudTranscriptionProvider: (provider: string) => void;
  cloudTranscriptionModel: string;
  setCloudTranscriptionModel: (model: string) => void;
  localTranscriptionProvider: string;
  setLocalTranscriptionProvider: (provider: LocalTranscriptionProvider) => void;
  whisperModel: string;
  setWhisperModel: (model: string) => void;
  parakeetModel: string;
  setParakeetModel: (model: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  deepgramApiKey: string;
  setDeepgramApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  mistralApiKey: string;
  setMistralApiKey: (key: string) => void;
  bailianApiKey: string;
  setBailianApiKey: (key: string) => void;
  deepgramStreamingEnabled: boolean;
  setDeepgramStreamingEnabled: (enabled: boolean) => void;
  customTranscriptionApiKey: string;
  setCustomTranscriptionApiKey: (key: string) => void;
  cloudTranscriptionBaseUrl?: string;
  setCloudTranscriptionBaseUrl: (url: string) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
  }) => void;
}

function TranscriptionSection({
  isSignedIn,
  cloudAuthAvailable,
  cloudTranscriptionMode,
  setCloudTranscriptionMode,
  useLocalWhisper,
  setUseLocalWhisper,
  updateTranscriptionSettings,
  cloudTranscriptionProvider,
  setCloudTranscriptionProvider,
  cloudTranscriptionModel,
  setCloudTranscriptionModel,
  localTranscriptionProvider,
  setLocalTranscriptionProvider,
  whisperModel,
  setWhisperModel,
  parakeetModel,
  setParakeetModel,
  openaiApiKey,
  setOpenaiApiKey,
  deepgramApiKey,
  setDeepgramApiKey,
  groqApiKey,
  setGroqApiKey,
  mistralApiKey,
  setMistralApiKey,
  bailianApiKey,
  setBailianApiKey,
  deepgramStreamingEnabled,
  setDeepgramStreamingEnabled,
  customTranscriptionApiKey,
  setCustomTranscriptionApiKey,
  cloudTranscriptionBaseUrl,
  setCloudTranscriptionBaseUrl,
  toast,
}: TranscriptionSectionProps) {
  const { t } = useTranslation();
  const mouthpieceSelected =
    (cloudTranscriptionMode === "mouthpiece" || cloudTranscriptionMode === "openwhispr") &&
    !useLocalWhisper;
  const mouthpieceLocked = !cloudAuthAvailable || !isSignedIn;
  const isCloudMode = mouthpieceSelected && !mouthpieceLocked;
  const isCustomMode = cloudTranscriptionMode === "byok" || useLocalWhisper;
  const showCustomSetup = isCustomMode || mouthpieceLocked;
  const cloudLockedLabel = !cloudAuthAvailable
    ? t("settingsPage.transcription.cloudDisabled")
    : t("settingsPage.transcription.cloudOffline");

  // NOTE: Mouthpiece Cloud option has been hidden as the cloud service is discontinued.
  // Only Custom Setup (BYOK) mode is now available for cloud transcription.

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.transcription.title")}
        description={t("settingsPage.transcription.description")}
      />

      {/* Mode selector - Only Custom Setup shown */}
      <SettingsPanel>
        <SettingsPanelRow>
          <button
            onClick={() => {
              if (!isCustomMode) {
                setCloudTranscriptionMode("byok");
                setUseLocalWhisper(false);
                updateTranscriptionSettings({ useLocalWhisper: false });
                toast({
                  title: t("settingsPage.transcription.toasts.switchedCustom.title"),
                  description: t("settingsPage.transcription.toasts.switchedCustom.description"),
                  variant: "success",
                  duration: 3000,
                });
              }
            }}
            className="w-full flex items-center gap-3 text-left cursor-pointer group"
          >
            <div
              className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                isCustomMode
                  ? "bg-accent/10 dark:bg-accent/15"
                  : "bg-muted/60 dark:bg-surface-raised group-hover:bg-muted dark:group-hover:bg-surface-3"
              }`}
            >
              <Key
                className={`w-4 h-4 transition-colors ${
                  isCustomMode ? "text-accent" : "text-muted-foreground"
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">
                  {t("settingsPage.transcription.customSetup")}
                </span>
                {isCustomMode && (
                  <span className="text-xs font-medium text-accent bg-accent/10 dark:bg-accent/15 px-1.5 py-px rounded-sm">
                    {t("common.active")}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground/80 mt-0.5">
                {t("settingsPage.transcription.customSetupDescription")}
              </p>
            </div>
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                isCustomMode
                  ? "border-accent bg-accent"
                  : "border-border-hover dark:border-border-subtle"
              }`}
            >
              {isCustomMode && (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-foreground" />
                </div>
              )}
            </div>
          </button>
        </SettingsPanelRow>
      </SettingsPanel>

      {/* Custom Setup model picker — shown when Custom Setup is active or not signed in */}
      {showCustomSetup && (
        <TranscriptionModelPicker
          selectedCloudProvider={cloudTranscriptionProvider}
          onCloudProviderSelect={setCloudTranscriptionProvider}
          selectedCloudModel={cloudTranscriptionModel}
          onCloudModelSelect={setCloudTranscriptionModel}
          selectedLocalModel={
            localTranscriptionProvider === "nvidia" ? parakeetModel : whisperModel
          }
          onLocalModelSelect={(modelId) => {
            if (localTranscriptionProvider === "nvidia") {
              setParakeetModel(modelId);
            } else {
              setWhisperModel(modelId);
            }
          }}
          selectedLocalProvider={localTranscriptionProvider}
          onLocalProviderSelect={setLocalTranscriptionProvider}
          useLocalWhisper={useLocalWhisper}
          onModeChange={(isLocal) => {
            setUseLocalWhisper(isLocal);
            updateTranscriptionSettings({ useLocalWhisper: isLocal });
            if (isLocal) {
              setCloudTranscriptionMode("byok");
            }
          }}
          openaiApiKey={openaiApiKey}
          setOpenaiApiKey={setOpenaiApiKey}
          deepgramApiKey={deepgramApiKey}
          setDeepgramApiKey={setDeepgramApiKey}
          groqApiKey={groqApiKey}
          setGroqApiKey={setGroqApiKey}
          mistralApiKey={mistralApiKey}
          setMistralApiKey={setMistralApiKey}
          bailianApiKey={bailianApiKey}
          setBailianApiKey={setBailianApiKey}
          deepgramStreamingEnabled={deepgramStreamingEnabled}
          setDeepgramStreamingEnabled={setDeepgramStreamingEnabled}
          customTranscriptionApiKey={customTranscriptionApiKey}
          setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
          cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
          setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
          variant="settings"
        />
      )}
    </div>
  );
}

interface AiModelsSectionProps {
  isSignedIn: boolean;
  cloudReasoningMode: string;
  setCloudReasoningMode: (mode: string) => void;
  useReasoningModel: boolean;
  setUseReasoningModel: (value: boolean) => void;
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
  reasoningProvider: string;
  setReasoningProvider: (provider: string) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (url: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  bailianApiKey: string;
  setBailianApiKey: (key: string) => void;
  bailianReasoningEnableThinking: boolean;
  setBailianReasoningEnableThinking: (enabled: boolean) => void;
  customReasoningApiKey: string;
  setCustomReasoningApiKey: (key: string) => void;
  customReasoningEnableThinking: boolean;
  setCustomReasoningEnableThinking: (enabled: boolean) => void;
  showAlertDialog: (dialog: { title: string; description: string }) => void;
  toast: (opts: {
    title: string;
    description: string;
    variant?: "default" | "destructive" | "success";
    duration?: number;
  }) => void;
}

function AiModelsSection({
  isSignedIn,
  cloudReasoningMode,
  setCloudReasoningMode,
  useReasoningModel,
  setUseReasoningModel,
  reasoningModel,
  setReasoningModel,
  reasoningProvider,
  setReasoningProvider,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
  openaiApiKey,
  setOpenaiApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  groqApiKey,
  setGroqApiKey,
  bailianApiKey,
  setBailianApiKey,
  bailianReasoningEnableThinking,
  setBailianReasoningEnableThinking,
  customReasoningApiKey,
  setCustomReasoningApiKey,
  customReasoningEnableThinking,
  setCustomReasoningEnableThinking,
  showAlertDialog,
  toast,
}: AiModelsSectionProps) {
  const { t } = useTranslation();
  const isCustomMode = cloudReasoningMode === "byok";

  // NOTE: Mouthpiece Cloud option has been hidden as the cloud service is discontinued.
  // Only Custom Setup (BYOK) mode is now available for AI models.

  return (
    <div className="space-y-4">
      <SectionHeader
        title={t("settingsPage.aiModels.title")}
        description={t("settingsPage.aiModels.description")}
      />

      {/* Enable toggle — always at top */}
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.aiModels.enableTextCleanup")}
            description={t("settingsPage.aiModels.enableTextCleanupDescription")}
          >
            <Toggle checked={useReasoningModel} onChange={setUseReasoningModel} />
          </SettingsRow>
        </SettingsPanelRow>
      </SettingsPanel>

      {useReasoningModel && (
        <>
          {/* Mode selector - NOTE: Mouthpiece Cloud option hidden, only Custom Setup shown */}
          <SettingsPanel>
            <SettingsPanelRow>
              <button
                onClick={() => {
                  if (!isCustomMode) {
                    setCloudReasoningMode("byok");
                    window.electronAPI?.llamaServerStop?.();
                    toast({
                      title: t("settingsPage.aiModels.toasts.switchedCustom.title"),
                      description: t("settingsPage.aiModels.toasts.switchedCustom.description"),
                      variant: "success",
                      duration: 3000,
                    });
                  }
                }}
                className="w-full flex items-center gap-3 text-left cursor-pointer group"
              >
                <div
                  className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                    isCustomMode
                      ? "bg-accent/10 dark:bg-accent/15"
                      : "bg-muted/60 dark:bg-surface-raised group-hover:bg-muted dark:group-hover:bg-surface-3"
                  }`}
                >
                  <Key
                    className={`w-4 h-4 transition-colors ${
                      isCustomMode ? "text-accent" : "text-muted-foreground"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">
                      {t("settingsPage.aiModels.customSetup")}
                    </span>
                    {isCustomMode && (
                      <span className="text-xs font-medium text-accent bg-accent/10 dark:bg-accent/15 px-1.5 py-px rounded-sm">
                        {t("common.active")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground/80 mt-0.5">
                    {t("settingsPage.aiModels.customSetupDescription")}
                  </p>
                </div>
                <div
                  className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                    isCustomMode
                      ? "border-accent bg-accent"
                      : "border-border-hover dark:border-border-subtle"
                  }`}
                >
                  {isCustomMode && (
                    <div className="w-full h-full flex items-center justify-center">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-foreground" />
                    </div>
                  )}
                </div>
              </button>
            </SettingsPanelRow>
          </SettingsPanel>

          {/* Custom Setup model picker — shown when Custom Setup is active or not signed in */}
          {(isCustomMode || !isSignedIn) && (
            <ReasoningModelSelector
              reasoningModel={reasoningModel}
              setReasoningModel={setReasoningModel}
              localReasoningProvider={reasoningProvider}
              setLocalReasoningProvider={setReasoningProvider}
              cloudReasoningBaseUrl={cloudReasoningBaseUrl}
              setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              anthropicApiKey={anthropicApiKey}
              setAnthropicApiKey={setAnthropicApiKey}
              geminiApiKey={geminiApiKey}
              setGeminiApiKey={setGeminiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              bailianApiKey={bailianApiKey}
              setBailianApiKey={setBailianApiKey}
              bailianReasoningEnableThinking={bailianReasoningEnableThinking}
              setBailianReasoningEnableThinking={setBailianReasoningEnableThinking}
              customReasoningApiKey={customReasoningApiKey}
              setCustomReasoningApiKey={setCustomReasoningApiKey}
              customReasoningEnableThinking={customReasoningEnableThinking}
              setCustomReasoningEnableThinking={setCustomReasoningEnableThinking}
            />
          )}
        </>
      )}
    </div>
  );
}

export default function SettingsPage({ activeSection = "general" }: SettingsPageProps) {
  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  const {
    useLocalWhisper,
    whisperModel,
    localTranscriptionProvider,
    parakeetModel,
    uiLanguage,
    preferredLanguage,
    cloudTranscriptionProvider,
    cloudTranscriptionModel,
    cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl,
    useReasoningModel,
    reasoningModel,
    reasoningProvider,
    bailianReasoningEnableThinking,
    customReasoningEnableThinking,
    openaiApiKey,
    deepgramApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    mistralApiKey,
    bailianApiKey,
    dictationKey,
    preferBuiltInMic,
    selectedMicDeviceId,
    setPreferBuiltInMic,
    setSelectedMicDeviceId,
    setUseLocalWhisper,
    setUiLanguage,
    setWhisperModel,
    setLocalTranscriptionProvider,
    setParakeetModel,
    setCloudTranscriptionProvider,
    setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl,
    setUseReasoningModel,
    setReasoningModel,
    setReasoningProvider,
    setBailianReasoningEnableThinking,
    setCustomReasoningEnableThinking,
    setOpenaiApiKey,
    setDeepgramApiKey,
    setAnthropicApiKey,
    setGeminiApiKey,
    setGroqApiKey,
    setMistralApiKey,
    setBailianApiKey,
    customTranscriptionApiKey,
    setCustomTranscriptionApiKey,
    customReasoningApiKey,
    setCustomReasoningApiKey,
    deepgramStreamingEnabled,
    setDeepgramStreamingEnabled,
    setDictationKey,
    autoLearnCorrections,
    setAutoLearnCorrections,
    updateTranscriptionSettings,
    updateReasoningSettings,
    cloudTranscriptionMode,
    setCloudTranscriptionMode,
    cloudReasoningMode,
    setCloudReasoningMode,
    audioCuesEnabled,
    setAudioCuesEnabled,
  } = useSettings();

  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { getModelCachePathHint } = modelCachePaths;

  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [isRemovingModels, setIsRemovingModels] = useState(false);
  const cachePathHint = getModelCachePathHint({
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    cacheDirName: CURRENT_CACHE_DIRNAME,
  });

  const whisperHook = useWhisper();
  const checkWhisperInstallation = whisperHook.checkWhisperInstallation;
  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog);

  const dictionaryAutoLearnCopy = useMemo(
    () => ({
      title: t("settingsPage.dictionary.autoLearnTitle", {
        defaultValue: "Auto-learn from corrections",
      }),
      description: t("settingsPage.dictionary.autoLearnDescription", {
        defaultValue:
          "When you correct a transcription in the target app, the corrected word is automatically added to your dictionary.",
      }),
    }),
    [t]
  );

  const themeOptions = useMemo(
    () =>
      [
        {
          value: "light",
          icon: Sun,
          label: t("settingsPage.general.appearance.light"),
        },
        {
          value: "dark",
          icon: Moon,
          label: t("settingsPage.general.appearance.dark"),
        },
        {
          value: "auto",
          icon: Monitor,
          label: t("settingsPage.general.appearance.auto"),
        },
      ] as const,
    [t]
  );

  const { theme, setTheme } = useTheme();

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: true,
    showAlert: showAlertDialog,
  });

  const validateHotkeyForInput = useCallback(
    (hotkey: string) => getValidationMessage(hotkey, getPlatform()),
    []
  );

  const [isUsingGnomeHotkeys, setIsUsingGnomeHotkeys] = useState(false);

  const platform = getCachedPlatform();

  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [autoStartLoading, setAutoStartLoading] = useState(true);

  useEffect(() => {
    if (platform === "linux") {
      setAutoStartLoading(false);
      return;
    }
    const loadAutoStart = async () => {
      if (window.electronAPI?.getAutoStartEnabled) {
        try {
          const enabled = await window.electronAPI.getAutoStartEnabled();
          setAutoStartEnabled(enabled);
        } catch (error) {
          logger.error("Failed to get auto-start status", error, "settings");
        }
      }
      setAutoStartLoading(false);
    };
    loadAutoStart();
  }, [platform]);

  const handleAutoStartChange = async (enabled: boolean) => {
    if (window.electronAPI?.setAutoStartEnabled) {
      try {
        setAutoStartLoading(true);
        const result = await window.electronAPI.setAutoStartEnabled(enabled);
        if (result.success) {
          setAutoStartEnabled(enabled);
        }
      } catch (error) {
        logger.error("Failed to set auto-start", error, "settings");
      } finally {
        setAutoStartLoading(false);
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    const timer = setTimeout(async () => {
      if (!mounted) return;

      try {
        const versionResult = await window.electronAPI?.getAppVersion?.();
        if (versionResult?.version && mounted) {
          setCurrentVersion(versionResult.version);
        }
      } catch (error) {
        logger.error("Failed to get app version", error, "settings");
      }

      if (mounted) {
        checkWhisperInstallation();
      }
    }, 100);

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [checkWhisperInstallation]);

  useEffect(() => {
    const checkHotkeyMode = async () => {
      try {
        const info = await window.electronAPI?.getHotkeyModeInfo();
        if (info?.isUsingGnome) {
          setIsUsingGnomeHotkeys(true);
        }
      } catch (error) {
        logger.error("Failed to check hotkey mode", error, "settings");
      }
    };
    checkHotkeyMode();
  }, []);

  const resetAccessibilityPermissions = () => {
    const message = t("settingsPage.permissions.resetAccessibility.description");

    showConfirmDialog({
      title: t("settingsPage.permissions.resetAccessibility.title"),
      description: message,
      onConfirm: () => {
        permissionsHook.openAccessibilitySettings();
      },
    });
  };

  const handleRemoveModels = useCallback(() => {
    if (isRemovingModels) return;

    showConfirmDialog({
      title: t("settingsPage.developer.removeModels.title"),
      description: t("settingsPage.developer.removeModels.description", { path: cachePathHint }),
      confirmText: t("settingsPage.developer.removeModels.confirmText"),
      variant: "destructive",
      onConfirm: async () => {
        setIsRemovingModels(true);
        try {
          const results = await Promise.allSettled([
            window.electronAPI?.deleteAllWhisperModels?.(),
            window.electronAPI?.deleteAllParakeetModels?.(),
            window.electronAPI?.modelDeleteAll?.(),
          ]);

          const anyFailed = results.some(
            (r) =>
              r.status === "rejected" || (r.status === "fulfilled" && r.value && !r.value.success)
          );

          if (anyFailed) {
            showAlertDialog({
              title: t("settingsPage.developer.removeModels.failedTitle"),
              description: t("settingsPage.developer.removeModels.failedDescription"),
            });
          } else {
            window.dispatchEvent(new Event("mouthpiece-models-cleared"));
            showAlertDialog({
              title: t("settingsPage.developer.removeModels.successTitle"),
              description: t("settingsPage.developer.removeModels.successDescription"),
            });
          }
        } catch {
          showAlertDialog({
            title: t("settingsPage.developer.removeModels.failedTitle"),
            description: t("settingsPage.developer.removeModels.failedDescriptionShort"),
          });
        } finally {
          setIsRemovingModels(false);
        }
      },
    });
  }, [isRemovingModels, cachePathHint, showConfirmDialog, showAlertDialog, t]);

  const { isSignedIn } = useAuth();

  const renderSectionContent = () => {
    switch (activeSection) {
      case "general":
        return (
          <div className="space-y-6">
            {/* Appearance */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.appearance.title")}
                description={t("settingsPage.general.appearance.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.appearance.theme")}
                    description={t("settingsPage.general.appearance.themeDescription")}
                  >
                    <div className="inline-flex items-center gap-px p-0.5 bg-muted/60 dark:bg-surface-2 rounded-md">
                      {themeOptions.map((option) => {
                        const Icon = option.icon;
                        const isSelected = theme === option.value;
                        return (
                          <button
                            key={option.value}
                            onClick={() => setTheme(option.value)}
                            className={`
                              flex items-center gap-1 px-2.5 py-1 rounded-[5px] text-xs font-medium
                              transition-colors duration-100
                              ${
                                isSelected
                                  ? "bg-background dark:bg-surface-raised text-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground"
                              }
                            `}
                          >
                            <Icon className={`w-3 h-3 ${isSelected ? "text-primary" : ""}`} />
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Sound Effects */}
            <div>
              <SectionHeader title={t("settingsPage.general.soundEffects.title")} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.general.soundEffects.dictationSounds")}
                    description={t("settingsPage.general.soundEffects.dictationSoundsDescription")}
                  >
                    <Toggle checked={audioCuesEnabled} onChange={setAudioCuesEnabled} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Language */}
            <div>
              <SectionHeader
                title={t("settings.language.sectionTitle")}
                description={t("settings.language.sectionDescription")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.language.uiLabel")}
                    description={t("settings.language.uiDescription")}
                  >
                    <LanguageSelector
                      value={uiLanguage}
                      onChange={setUiLanguage}
                      options={[...UI_LANGUAGE_OPTIONS]}
                      className="min-w-32"
                    />
                  </SettingsRow>
                </SettingsPanelRow>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settings.language.transcriptionLabel")}
                    description={t("settings.language.transcriptionDescription")}
                  >
                    <LanguageSelector
                      value={preferredLanguage}
                      onChange={(value) =>
                        updateTranscriptionSettings({ preferredLanguage: value })
                      }
                    />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Startup */}
            {platform !== "linux" && (
              <div>
                <SectionHeader title={t("settingsPage.general.startup.title")} />
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.general.startup.launchAtLogin")}
                      description={t("settingsPage.general.startup.launchAtLoginDescription")}
                    >
                      <Toggle
                        checked={autoStartEnabled}
                        onChange={(checked: boolean) => handleAutoStartChange(checked)}
                        disabled={autoStartLoading}
                      />
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              </div>
            )}

            {/* Microphone */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.microphone.title")}
                description={t("settingsPage.general.microphone.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <MicrophoneSettings
                    preferBuiltInMic={preferBuiltInMic}
                    selectedMicDeviceId={selectedMicDeviceId}
                    onPreferBuiltInChange={setPreferBuiltInMic}
                    onDeviceSelect={setSelectedMicDeviceId}
                  />
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Dictionary */}
            <div>
              <SectionHeader title={dictionaryAutoLearnCopy.title} />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={dictionaryAutoLearnCopy.title}
                    description={dictionaryAutoLearnCopy.description}
                  >
                    <Toggle checked={autoLearnCorrections} onChange={setAutoLearnCorrections} />
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
          </div>
        );

      case "hotkeys":
        return (
          <div className="space-y-6">
            {/* Dictation Hotkey */}
            <div>
              <SectionHeader
                title={t("settingsPage.general.hotkey.title")}
                description={t("settingsPage.general.hotkey.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <HotkeyInput
                    value={dictationKey}
                    onChange={async (newHotkey) => {
                      await registerHotkey(newHotkey);
                    }}
                    disabled={isHotkeyRegistering}
                    validate={validateHotkeyForInput}
                  />
                  {dictationKey && dictationKey !== getDefaultHotkey() && (
                    <button
                      onClick={() => registerHotkey(getDefaultHotkey())}
                      disabled={isHotkeyRegistering}
                      className="mt-2 text-xs text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      {t("settingsPage.general.hotkey.resetToDefault", {
                        hotkey: formatHotkeyLabel(getDefaultHotkey()),
                      })}
                    </button>
                  )}
                </SettingsPanelRow>

                <SettingsPanelRow className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground/80">
                    {t("settingsPage.general.hotkey.activationBehavior")}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground/70">
                    {t("settingsPage.general.hotkey.activationBehaviorDescription")}
                  </p>
                  {isUsingGnomeHotkeys && (
                    <p className="text-xs leading-relaxed text-muted-foreground/60">
                      {t("settingsPage.general.hotkey.activationBehaviorFallback")}
                    </p>
                  )}
                </SettingsPanelRow>
              </SettingsPanel>
            </div>
          </div>
        );

      case "transcription":
        return (
          <TranscriptionSection
            isSignedIn={isSignedIn ?? false}
            cloudAuthAvailable={Boolean(NEON_AUTH_URL)}
            cloudTranscriptionMode={cloudTranscriptionMode}
            setCloudTranscriptionMode={setCloudTranscriptionMode}
            useLocalWhisper={useLocalWhisper}
            setUseLocalWhisper={setUseLocalWhisper}
            updateTranscriptionSettings={updateTranscriptionSettings}
            cloudTranscriptionProvider={cloudTranscriptionProvider}
            setCloudTranscriptionProvider={setCloudTranscriptionProvider}
            cloudTranscriptionModel={cloudTranscriptionModel}
            setCloudTranscriptionModel={setCloudTranscriptionModel}
            localTranscriptionProvider={localTranscriptionProvider}
            setLocalTranscriptionProvider={setLocalTranscriptionProvider}
            whisperModel={whisperModel}
            setWhisperModel={setWhisperModel}
            parakeetModel={parakeetModel}
            setParakeetModel={setParakeetModel}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            deepgramApiKey={deepgramApiKey}
            setDeepgramApiKey={setDeepgramApiKey}
            groqApiKey={groqApiKey}
            setGroqApiKey={setGroqApiKey}
            mistralApiKey={mistralApiKey}
            setMistralApiKey={setMistralApiKey}
            bailianApiKey={bailianApiKey}
            setBailianApiKey={setBailianApiKey}
            deepgramStreamingEnabled={deepgramStreamingEnabled}
            setDeepgramStreamingEnabled={setDeepgramStreamingEnabled}
            customTranscriptionApiKey={customTranscriptionApiKey}
            setCustomTranscriptionApiKey={setCustomTranscriptionApiKey}
            cloudTranscriptionBaseUrl={cloudTranscriptionBaseUrl}
            setCloudTranscriptionBaseUrl={setCloudTranscriptionBaseUrl}
            toast={toast}
          />
        );

      case "aiModels":
        return (
          <AiModelsSection
            isSignedIn={isSignedIn ?? false}
            cloudReasoningMode={cloudReasoningMode}
            setCloudReasoningMode={setCloudReasoningMode}
            useReasoningModel={useReasoningModel}
            setUseReasoningModel={(value) => {
              setUseReasoningModel(value);
              updateReasoningSettings({ useReasoningModel: value });
            }}
            reasoningModel={reasoningModel}
            setReasoningModel={setReasoningModel}
            reasoningProvider={reasoningProvider}
            setReasoningProvider={setReasoningProvider}
            cloudReasoningBaseUrl={cloudReasoningBaseUrl}
            setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
            openaiApiKey={openaiApiKey}
            setOpenaiApiKey={setOpenaiApiKey}
            anthropicApiKey={anthropicApiKey}
            setAnthropicApiKey={setAnthropicApiKey}
            geminiApiKey={geminiApiKey}
            setGeminiApiKey={setGeminiApiKey}
            groqApiKey={groqApiKey}
            setGroqApiKey={setGroqApiKey}
            bailianApiKey={bailianApiKey}
            setBailianApiKey={setBailianApiKey}
            bailianReasoningEnableThinking={bailianReasoningEnableThinking}
            setBailianReasoningEnableThinking={setBailianReasoningEnableThinking}
            customReasoningApiKey={customReasoningApiKey}
            setCustomReasoningApiKey={setCustomReasoningApiKey}
            customReasoningEnableThinking={customReasoningEnableThinking}
            setCustomReasoningEnableThinking={setCustomReasoningEnableThinking}
            showAlertDialog={showAlertDialog}
            toast={toast}
          />
        );

      case "prompts":
        return (
          <div className="space-y-5">
            <SectionHeader
              title={t("settingsPage.prompts.title")}
              description={t("settingsPage.prompts.description")}
            />

            <PromptStudio />
          </div>
        );

      case "intelligence":
        return (
          <div className="space-y-6">
            <AiModelsSection
              isSignedIn={isSignedIn ?? false}
              cloudReasoningMode={cloudReasoningMode}
              setCloudReasoningMode={setCloudReasoningMode}
              useReasoningModel={useReasoningModel}
              setUseReasoningModel={(value) => {
                updateReasoningSettings({ useReasoningModel: value });
              }}
              reasoningModel={reasoningModel}
              setReasoningModel={setReasoningModel}
              reasoningProvider={reasoningProvider}
              setReasoningProvider={setReasoningProvider}
              cloudReasoningBaseUrl={cloudReasoningBaseUrl}
              setCloudReasoningBaseUrl={setCloudReasoningBaseUrl}
              openaiApiKey={openaiApiKey}
              setOpenaiApiKey={setOpenaiApiKey}
              anthropicApiKey={anthropicApiKey}
              setAnthropicApiKey={setAnthropicApiKey}
              geminiApiKey={geminiApiKey}
              setGeminiApiKey={setGeminiApiKey}
              groqApiKey={groqApiKey}
              setGroqApiKey={setGroqApiKey}
              bailianApiKey={bailianApiKey}
              setBailianApiKey={setBailianApiKey}
              bailianReasoningEnableThinking={bailianReasoningEnableThinking}
              setBailianReasoningEnableThinking={setBailianReasoningEnableThinking}
              customReasoningApiKey={customReasoningApiKey}
              setCustomReasoningApiKey={setCustomReasoningApiKey}
              customReasoningEnableThinking={customReasoningEnableThinking}
              setCustomReasoningEnableThinking={setCustomReasoningEnableThinking}
              showAlertDialog={showAlertDialog}
              toast={toast}
            />

            {/* System Prompt */}
            <div className="border-t border-border/40 pt-6">
              <SectionHeader
                title={t("settingsPage.prompts.title")}
                description={t("settingsPage.prompts.description")}
              />
              <PromptStudio />
            </div>
          </div>
        );

      case "privacyData":
        // NOTE: Privacy module has been removed. Redirect to system section.
        return (
          <div className="space-y-6">
            <SectionHeader
              title={t("settingsPage.permissions.title")}
              description={t("settingsPage.permissions.description")}
            />

            <div className="space-y-3">
              <PermissionCard
                icon={Mic}
                title={t("settingsPage.permissions.microphoneTitle")}
                description={t("settingsPage.permissions.microphoneDescription")}
                granted={permissionsHook.micPermissionGranted}
                onRequest={permissionsHook.requestMicPermission}
                buttonText={t("settingsPage.permissions.test")}
                onOpenSettings={permissionsHook.openMicPrivacySettings}
              />

              {platform === "darwin" && (
                <PermissionCard
                  icon={Shield}
                  title={t("settingsPage.permissions.accessibilityTitle")}
                  description={t("settingsPage.permissions.accessibilityDescription")}
                  granted={permissionsHook.accessibilityPermissionGranted}
                  onRequest={permissionsHook.testAccessibilityPermission}
                  buttonText={t("settingsPage.permissions.testAndGrant")}
                  onOpenSettings={permissionsHook.openAccessibilitySettings}
                />
              )}
            </div>

            {!permissionsHook.micPermissionGranted && permissionsHook.micPermissionError && (
              <MicPermissionWarning
                error={permissionsHook.micPermissionError}
                onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
              />
            )}

            {platform === "linux" &&
              permissionsHook.pasteToolsInfo &&
              !permissionsHook.pasteToolsInfo.available && (
                <PasteToolsInfo
                  pasteToolsInfo={permissionsHook.pasteToolsInfo}
                  isChecking={permissionsHook.isCheckingPasteTools}
                  onCheck={permissionsHook.checkPasteToolsAvailability}
                />
              )}

            {platform === "darwin" && (
              <div className="mt-5">
                <p className="text-xs font-medium text-foreground mb-3">
                  {t("settingsPage.permissions.troubleshootingTitle")}
                </p>
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.permissions.resetAccessibility.label")}
                      description={t("settingsPage.permissions.resetAccessibility.rowDescription")}
                    >
                      <Button
                        onClick={resetAccessibilityPermissions}
                        variant="ghost"
                        size="sm"
                        className="text-foreground/70 hover:text-foreground"
                      >
                        {t("settingsPage.permissions.troubleshoot")}
                      </Button>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              </div>
            )}
          </div>
        );

      case "system":
        return (
          <div className="space-y-6">
            {/* App Version */}
            <div>
              <SectionHeader
                title={t("settingsPage.system.title")}
                description={t("settingsPage.system.description")}
              />
              <SettingsPanel>
                <SettingsPanelRow>
                  <SettingsRow
                    label={t("settingsPage.system.currentVersion")}
                    description={t("settingsPage.system.versionDescription")}
                  >
                    <span className="text-xs tabular-nums text-muted-foreground font-mono">
                      {currentVersion || t("settingsPage.system.versionPlaceholder")}
                    </span>
                  </SettingsRow>
                </SettingsPanelRow>
              </SettingsPanel>
            </div>

            {/* Developer Tools */}
            <div className="border-t border-border/40 pt-6">
              <DeveloperSection />
            </div>

            {/* Data Management */}
            <div className="border-t border-border/40 pt-6">
              <SectionHeader
                title={t("settingsPage.developer.dataManagementTitle")}
                description={t("settingsPage.developer.dataManagementDescription")}
              />

              <div className="space-y-4">
                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.modelCache")}
                      description={cachePathHint}
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => window.electronAPI?.openWhisperModelsFolder?.()}
                        >
                          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
                          {t("settingsPage.developer.open")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={handleRemoveModels}
                          disabled={isRemovingModels}
                        >
                          {isRemovingModels
                            ? t("settingsPage.developer.removing")
                            : t("settingsPage.developer.clearCache")}
                        </Button>
                      </div>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>

                <SettingsPanel>
                  <SettingsPanelRow>
                    <SettingsRow
                      label={t("settingsPage.developer.resetAppData")}
                      description={t("settingsPage.developer.resetAppDataDescription")}
                    >
                      <Button
                        onClick={() => {
                          showConfirmDialog({
                            title: t("settingsPage.developer.resetAll.title"),
                            description: t("settingsPage.developer.resetAll.description"),
                            onConfirm: () => {
                              window.electronAPI
                                ?.cleanupApp()
                                .then(() => {
                                  showAlertDialog({
                                    title: t("settingsPage.developer.resetAll.successTitle"),
                                    description: t(
                                      "settingsPage.developer.resetAll.successDescription"
                                    ),
                                  });
                                  setTimeout(() => {
                                    window.location.reload();
                                  }, 1000);
                                })
                                .catch(() => {
                                  showAlertDialog({
                                    title: t("settingsPage.developer.resetAll.failedTitle"),
                                    description: t(
                                      "settingsPage.developer.resetAll.failedDescription"
                                    ),
                                  });
                                });
                            },
                            variant: "destructive",
                            confirmText: t("settingsPage.developer.resetAll.confirmText"),
                          });
                        }}
                        variant="outline"
                        size="sm"
                        className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive"
                      >
                        {t("common.reset")}
                      </Button>
                    </SettingsRow>
                  </SettingsPanelRow>
                </SettingsPanel>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {renderSectionContent()}
    </>
  );
}
