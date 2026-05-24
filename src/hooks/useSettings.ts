import React, { createContext, useContext, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
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
  // useShallow wraps the projection so the returned object identity stays
  // stable across re-renders when every selected value is shallow-equal.
  // Previously this hook called useSettingsStore() (whole-store sub) and
  // returned a fresh 80-key object literal on every render — any store
  // mutation cascaded through the SettingsContext.Provider to all
  // consumers (SettingsPage, ControlPanel, DictionaryView, etc.) even if
  // they read none of the changed slices. With useShallow the hook only
  // re-renders + re-emits a new context value when at least one of the
  // selected values actually changed.
  const store = useSettingsStore(
    useShallow((s) => ({
      useLocalWhisper: s.useLocalWhisper,
      whisperModel: s.whisperModel,
      uiLanguage: s.uiLanguage,
      localTranscriptionProvider: s.localTranscriptionProvider,
      parakeetModel: s.parakeetModel,
      qwenAsrModel: s.qwenAsrModel,
      allowOpenAIFallback: s.allowOpenAIFallback,
      allowLocalFallback: s.allowLocalFallback,
      fallbackWhisperModel: s.fallbackWhisperModel,
      preferredLanguage: s.preferredLanguage,
      cloudTranscriptionProvider: s.cloudTranscriptionProvider,
      cloudTranscriptionModel: s.cloudTranscriptionModel,
      cloudTranscriptionBaseUrl: s.cloudTranscriptionBaseUrl,
      cloudReasoningBaseUrl: s.cloudReasoningBaseUrl,
      cloudTranscriptionMode: s.cloudTranscriptionMode,
      cloudReasoningMode: s.cloudReasoningMode,
      bailianReasoningEnableThinking: s.bailianReasoningEnableThinking,
      customReasoningEnableThinking: s.customReasoningEnableThinking,
      customDictionary: s.customDictionary,
      terminologyProfile: s.terminologyProfile,
      assemblyAiStreaming: s.assemblyAiStreaming,
      deepgramStreamingEnabled: s.deepgramStreamingEnabled,
      sonioxRealtimeEnabled: s.sonioxRealtimeEnabled,
      bailianRealtimeEnabled: s.bailianRealtimeEnabled,
      setAssemblyAiStreaming: s.setAssemblyAiStreaming,
      setDeepgramStreamingEnabled: s.setDeepgramStreamingEnabled,
      setSonioxRealtimeEnabled: s.setSonioxRealtimeEnabled,
      setBailianRealtimeEnabled: s.setBailianRealtimeEnabled,
      useReasoningModel: s.useReasoningModel,
      reasoningModel: s.reasoningModel,
      reasoningProvider: s.reasoningProvider,
      translationEnabled: s.translationEnabled,
      translationTargetLang: s.translationTargetLang,
      translationDictationKey: s.translationDictationKey,
      openaiApiKey: s.openaiApiKey,
      anthropicApiKey: s.anthropicApiKey,
      deepgramApiKey: s.deepgramApiKey,
      geminiApiKey: s.geminiApiKey,
      groqApiKey: s.groqApiKey,
      mistralApiKey: s.mistralApiKey,
      sonioxApiKey: s.sonioxApiKey,
      bailianApiKey: s.bailianApiKey,
      dictationKey: s.dictationKey,
      theme: s.theme,
      setUseLocalWhisper: s.setUseLocalWhisper,
      setWhisperModel: s.setWhisperModel,
      setUiLanguage: s.setUiLanguage,
      setLocalTranscriptionProvider: s.setLocalTranscriptionProvider,
      setParakeetModel: s.setParakeetModel,
      setQwenAsrModel: s.setQwenAsrModel,
      setAllowOpenAIFallback: s.setAllowOpenAIFallback,
      setAllowLocalFallback: s.setAllowLocalFallback,
      setFallbackWhisperModel: s.setFallbackWhisperModel,
      setPreferredLanguage: s.setPreferredLanguage,
      setCloudTranscriptionProvider: s.setCloudTranscriptionProvider,
      setCloudTranscriptionModel: s.setCloudTranscriptionModel,
      setCloudTranscriptionBaseUrl: s.setCloudTranscriptionBaseUrl,
      setCloudReasoningBaseUrl: s.setCloudReasoningBaseUrl,
      setCloudTranscriptionMode: s.setCloudTranscriptionMode,
      setCloudReasoningMode: s.setCloudReasoningMode,
      setBailianReasoningEnableThinking: s.setBailianReasoningEnableThinking,
      setCustomReasoningEnableThinking: s.setCustomReasoningEnableThinking,
      setCustomDictionary: s.setCustomDictionary,
      setTerminologyProfile: s.setTerminologyProfile,
      setUseReasoningModel: s.setUseReasoningModel,
      setReasoningModel: s.setReasoningModel,
      setReasoningProvider: s.setReasoningProvider,
      setTranslationEnabled: s.setTranslationEnabled,
      setTranslationTargetLang: s.setTranslationTargetLang,
      setTranslationDictationKey: s.setTranslationDictationKey,
      setOpenaiApiKey: s.setOpenaiApiKey,
      setAnthropicApiKey: s.setAnthropicApiKey,
      setDeepgramApiKey: s.setDeepgramApiKey,
      setGeminiApiKey: s.setGeminiApiKey,
      setGroqApiKey: s.setGroqApiKey,
      setMistralApiKey: s.setMistralApiKey,
      setSonioxApiKey: s.setSonioxApiKey,
      setBailianApiKey: s.setBailianApiKey,
      customTranscriptionApiKey: s.customTranscriptionApiKey,
      setCustomTranscriptionApiKey: s.setCustomTranscriptionApiKey,
      customReasoningApiKey: s.customReasoningApiKey,
      setCustomReasoningApiKey: s.setCustomReasoningApiKey,
      setDictationKey: s.setDictationKey,
      setTheme: s.setTheme,
      audioCuesEnabled: s.audioCuesEnabled,
      setAudioCuesEnabled: s.setAudioCuesEnabled,
      selectedMicDeviceId: s.selectedMicDeviceId,
      setSelectedMicDeviceId: s.setSelectedMicDeviceId,
      cloudBackupEnabled: s.cloudBackupEnabled,
      sensitiveAppProtectionEnabled: s.sensitiveAppProtectionEnabled,
      sensitiveAppBlockInsertion: s.sensitiveAppBlockInsertion,
      allowSensitiveAppCloudReasoning: s.allowSensitiveAppCloudReasoning,
      allowSensitiveAppPasteMonitoring: s.allowSensitiveAppPasteMonitoring,
      setCloudBackupEnabled: s.setCloudBackupEnabled,
      setSensitiveAppProtectionEnabled: s.setSensitiveAppProtectionEnabled,
      setSensitiveAppBlockInsertion: s.setSensitiveAppBlockInsertion,
      setAllowSensitiveAppCloudReasoning: s.setAllowSensitiveAppCloudReasoning,
      setAllowSensitiveAppPasteMonitoring: s.setAllowSensitiveAppPasteMonitoring,
      updateTranscriptionSettings: s.updateTranscriptionSettings,
      updateReasoningSettings: s.updateReasoningSettings,
      updateApiKeys: s.updateApiKeys,
    }))
  );
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

  // Identity-stable because `store` itself is already shallow-equal-stable
  // (via useShallow above), so returning it directly avoids the per-render
  // allocation of a fresh 80-key literal. Provider value identity now only
  // changes when at least one selected value changed.
  return store;
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
