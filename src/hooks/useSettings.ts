import React, { createContext, useContext, useEffect, useRef } from "react";
import { useSettingsStore, initializeSettings } from "../stores/settingsStore";
import logger from "../utils/logger";
import type { LocalTranscriptionProvider } from "../types/electron";
import type { TerminologyProfile } from "../utils/terminologyProfile";

export interface TranscriptionSettings {
  uiLanguage: string;
  useLocalWhisper: boolean;
  whisperModel: string;
  localTranscriptionProvider: LocalTranscriptionProvider;
  parakeetModel: string;
  qwenAsrModel: string;
  allowOpenAIFallback: boolean;
  allowLocalFallback: boolean;
  fallbackWhisperModel: string;
  preferredLanguage: string;
  cloudTranscriptionProvider: string;
  cloudTranscriptionModel: string;
  cloudTranscriptionBaseUrl?: string;
  cloudTranscriptionMode: string;
  customDictionary: string[];
  assemblyAiStreaming: boolean;
  deepgramStreamingEnabled: boolean;
  sonioxRealtimeEnabled: boolean;
  bailianRealtimeEnabled: boolean;
  terminologyProfile: TerminologyProfile;
}

export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  cloudReasoningBaseUrl?: string;
  cloudReasoningMode: string;
  bailianReasoningEnableThinking: boolean;
  customReasoningEnableThinking: boolean;
  translationEnabled: boolean;
  translationTargetLang: string;
  translationDictationKey: string;
}

export interface HotkeySettings {
  dictationKey: string;
}

export interface MicrophoneSettings {
  selectedMicDeviceId: string;
}

export interface ApiKeySettings {
  openaiApiKey: string;
  anthropicApiKey: string;
  deepgramApiKey: string;
  geminiApiKey: string;
  groqApiKey: string;
  mistralApiKey: string;
  sonioxApiKey: string;
  bailianApiKey: string;
  customTranscriptionApiKey: string;
  customReasoningApiKey: string;
}

export interface PrivacySettings {
  cloudBackupEnabled: boolean;
  sensitiveAppProtectionEnabled: boolean;
  sensitiveAppBlockInsertion: boolean;
  allowSensitiveAppCloudReasoning: boolean;
  allowSensitiveAppPasteMonitoring: boolean;
}

export interface ThemeSettings {
  theme: "light" | "dark" | "auto";
}

function useSettingsInternal() {
  const store = useSettingsStore();
  const setCustomDictionary = store.setCustomDictionary;

  // One-time initialization: sync API keys, dictation key, UI language,
  // and dictionary from the main process / SQLite.
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    initializeSettings().catch((err) => {
      logger.warn(
        "Failed to initialize settings store",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, []);

  // Listen for dictionary updates from main process
  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.onDictionaryUpdated) return;
    const unsubscribe = window.electronAPI.onDictionaryUpdated((words: string[]) => {
      if (Array.isArray(words)) {
        setCustomDictionary(words);
      }
    });
    return unsubscribe;
  }, [setCustomDictionary]);

  // Sync startup pre-warming preferences to main process
  const {
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    qwenAsrModel,
    reasoningProvider,
    reasoningModel,
  } = store;

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.syncStartupPreferences) return;

    const model =
      localTranscriptionProvider === "qwen"
        ? qwenAsrModel
        : localTranscriptionProvider === "nvidia"
          ? parakeetModel
          : whisperModel;
    window.electronAPI
      .syncStartupPreferences({
        useLocalWhisper,
        localTranscriptionProvider,
        model: model || undefined,
        reasoningProvider,
        reasoningModel: reasoningProvider === "local" ? reasoningModel : undefined,
      })
      .catch((err) =>
        logger.warn(
          "Failed to sync startup preferences",
          { error: (err as Error).message },
          "settings"
        )
      );
  }, [
    useLocalWhisper,
    localTranscriptionProvider,
    whisperModel,
    parakeetModel,
    qwenAsrModel,
    reasoningProvider,
    reasoningModel,
  ]);

  // Sync translation hotkey config to main process so globalShortcut stays in sync
  // with translationEnabled / translationDictationKey / dictationKey edits.
  const {
    translationEnabled: translationEnabledForSync,
    translationDictationKey: translationDictationKeyForSync,
    dictationKey: dictationKeyForSync,
  } = store;

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI?.applyTranslationHotkey) return;
    window.electronAPI.applyTranslationHotkey({
      enabled: translationEnabledForSync,
      hotkey: translationDictationKeyForSync,
      mainHotkey: dictationKeyForSync,
    });
  }, [translationEnabledForSync, translationDictationKeyForSync, dictationKeyForSync]);

  return {
    useLocalWhisper: store.useLocalWhisper,
    whisperModel: store.whisperModel,
    uiLanguage: store.uiLanguage,
    localTranscriptionProvider: store.localTranscriptionProvider,
    parakeetModel: store.parakeetModel,
    qwenAsrModel: store.qwenAsrModel,
    allowOpenAIFallback: store.allowOpenAIFallback,
    allowLocalFallback: store.allowLocalFallback,
    fallbackWhisperModel: store.fallbackWhisperModel,
    preferredLanguage: store.preferredLanguage,
    cloudTranscriptionProvider: store.cloudTranscriptionProvider,
    cloudTranscriptionModel: store.cloudTranscriptionModel,
    cloudTranscriptionBaseUrl: store.cloudTranscriptionBaseUrl,
    cloudReasoningBaseUrl: store.cloudReasoningBaseUrl,
    cloudTranscriptionMode: store.cloudTranscriptionMode,
    cloudReasoningMode: store.cloudReasoningMode,
    bailianReasoningEnableThinking: store.bailianReasoningEnableThinking,
    customReasoningEnableThinking: store.customReasoningEnableThinking,
    customDictionary: store.customDictionary,
    terminologyProfile: store.terminologyProfile,
    assemblyAiStreaming: store.assemblyAiStreaming,
    deepgramStreamingEnabled: store.deepgramStreamingEnabled,
    sonioxRealtimeEnabled: store.sonioxRealtimeEnabled,
    bailianRealtimeEnabled: store.bailianRealtimeEnabled,
    setAssemblyAiStreaming: store.setAssemblyAiStreaming,
    setDeepgramStreamingEnabled: store.setDeepgramStreamingEnabled,
    setSonioxRealtimeEnabled: store.setSonioxRealtimeEnabled,
    setBailianRealtimeEnabled: store.setBailianRealtimeEnabled,
    useReasoningModel: store.useReasoningModel,
    reasoningModel: store.reasoningModel,
    reasoningProvider: store.reasoningProvider,
    translationEnabled: store.translationEnabled,
    translationTargetLang: store.translationTargetLang,
    translationDictationKey: store.translationDictationKey,
    openaiApiKey: store.openaiApiKey,
    anthropicApiKey: store.anthropicApiKey,
    deepgramApiKey: store.deepgramApiKey,
    geminiApiKey: store.geminiApiKey,
    groqApiKey: store.groqApiKey,
    mistralApiKey: store.mistralApiKey,
    sonioxApiKey: store.sonioxApiKey,
    bailianApiKey: store.bailianApiKey,
    dictationKey: store.dictationKey,
    theme: store.theme,
    setUseLocalWhisper: store.setUseLocalWhisper,
    setWhisperModel: store.setWhisperModel,
    setUiLanguage: store.setUiLanguage,
    setLocalTranscriptionProvider: store.setLocalTranscriptionProvider,
    setParakeetModel: store.setParakeetModel,
    setQwenAsrModel: store.setQwenAsrModel,
    setAllowOpenAIFallback: store.setAllowOpenAIFallback,
    setAllowLocalFallback: store.setAllowLocalFallback,
    setFallbackWhisperModel: store.setFallbackWhisperModel,
    setPreferredLanguage: store.setPreferredLanguage,
    setCloudTranscriptionProvider: store.setCloudTranscriptionProvider,
    setCloudTranscriptionModel: store.setCloudTranscriptionModel,
    setCloudTranscriptionBaseUrl: store.setCloudTranscriptionBaseUrl,
    setCloudReasoningBaseUrl: store.setCloudReasoningBaseUrl,
    setCloudTranscriptionMode: store.setCloudTranscriptionMode,
    setCloudReasoningMode: store.setCloudReasoningMode,
    setBailianReasoningEnableThinking: store.setBailianReasoningEnableThinking,
    setCustomReasoningEnableThinking: store.setCustomReasoningEnableThinking,
    setCustomDictionary: store.setCustomDictionary,
    setTerminologyProfile: store.setTerminologyProfile,
    setUseReasoningModel: store.setUseReasoningModel,
    setReasoningModel: store.setReasoningModel,
    setReasoningProvider: store.setReasoningProvider,
    setTranslationEnabled: store.setTranslationEnabled,
    setTranslationTargetLang: store.setTranslationTargetLang,
    setTranslationDictationKey: store.setTranslationDictationKey,
    setOpenaiApiKey: store.setOpenaiApiKey,
    setAnthropicApiKey: store.setAnthropicApiKey,
    setDeepgramApiKey: store.setDeepgramApiKey,
    setGeminiApiKey: store.setGeminiApiKey,
    setGroqApiKey: store.setGroqApiKey,
    setMistralApiKey: store.setMistralApiKey,
    setSonioxApiKey: store.setSonioxApiKey,
    setBailianApiKey: store.setBailianApiKey,
    customTranscriptionApiKey: store.customTranscriptionApiKey,
    setCustomTranscriptionApiKey: store.setCustomTranscriptionApiKey,
    customReasoningApiKey: store.customReasoningApiKey,
    setCustomReasoningApiKey: store.setCustomReasoningApiKey,
    setDictationKey: store.setDictationKey,
    setTheme: store.setTheme,
    audioCuesEnabled: store.audioCuesEnabled,
    setAudioCuesEnabled: store.setAudioCuesEnabled,
    selectedMicDeviceId: store.selectedMicDeviceId,
    setSelectedMicDeviceId: store.setSelectedMicDeviceId,
    cloudBackupEnabled: store.cloudBackupEnabled,
    sensitiveAppProtectionEnabled: store.sensitiveAppProtectionEnabled,
    sensitiveAppBlockInsertion: store.sensitiveAppBlockInsertion,
    allowSensitiveAppCloudReasoning: store.allowSensitiveAppCloudReasoning,
    allowSensitiveAppPasteMonitoring: store.allowSensitiveAppPasteMonitoring,
    setCloudBackupEnabled: store.setCloudBackupEnabled,
    setSensitiveAppProtectionEnabled: store.setSensitiveAppProtectionEnabled,
    setSensitiveAppBlockInsertion: store.setSensitiveAppBlockInsertion,
    setAllowSensitiveAppCloudReasoning: store.setAllowSensitiveAppCloudReasoning,
    setAllowSensitiveAppPasteMonitoring: store.setAllowSensitiveAppPasteMonitoring,
    updateTranscriptionSettings: store.updateTranscriptionSettings,
    updateReasoningSettings: store.updateReasoningSettings,
    updateApiKeys: store.updateApiKeys,
  };
}

export type SettingsValue = ReturnType<typeof useSettingsInternal>;

declare global {
  var __mouthpieceSettingsContext: React.Context<SettingsValue | null> | undefined;
}

const SettingsContext =
  globalThis.__mouthpieceSettingsContext ?? createContext<SettingsValue | null>(null);

if (!globalThis.__mouthpieceSettingsContext) {
  globalThis.__mouthpieceSettingsContext = SettingsContext;
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const value = useSettingsInternal();
  return React.createElement(SettingsContext.Provider, { value }, children);
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return ctx;
}
