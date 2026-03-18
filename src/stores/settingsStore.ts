import { create } from "zustand";
import { API_ENDPOINTS } from "../config/constants";
import { RUNTIME_CONFIG } from "../config/runtimeConfig";
import i18n, { normalizeUiLanguage } from "../i18n";
import { hasAnyByokKey } from "../utils/byokDetection";
import { ensureAgentNameInDictionary } from "../utils/agentName";
import { normalizeCloudTranscriptionProviderSettings } from "../utils/transcriptionProviderConfig.mjs";
import logger from "../utils/logger";
import type { LocalTranscriptionProvider } from "../types/electron";
import type {
  TranscriptionSettings,
  ReasoningSettings,
  HotkeySettings,
  MicrophoneSettings,
  ApiKeySettings,
  PrivacySettings,
  ThemeSettings,
} from "../hooks/useSettings";

let _ReasoningService: typeof import("../services/ReasoningService").default | null = null;

const isBrowser = typeof window !== "undefined";
const MOUTHPIECE_CLOUD_ENABLED = Boolean(RUNTIME_CONFIG.enableMouthpieceCloud);
const CLOUD_AUTH_AVAILABLE = MOUTHPIECE_CLOUD_ENABLED && Boolean(RUNTIME_CONFIG.authUrl);

function normalizeCloudMode(value: string | null | undefined): string {
  const trimmed = (value || "").trim();
  if (!trimmed) {
    return "byok";
  }

  if (!MOUTHPIECE_CLOUD_ENABLED && (trimmed === "openwhispr" || trimmed === "mouthpiece")) {
    return "byok";
  }

  // Normalize legacy "openwhispr" to "mouthpiece" for cloud mode
  if (trimmed === "openwhispr") {
    return "mouthpiece";
  }

  return trimmed;
}

function readString(key: string, fallback: string): string {
  if (!isBrowser) return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function readBoolean(key: string, fallback: boolean): boolean {
  if (!isBrowser) return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  if (fallback === true) return stored !== "false";
  return stored === "true";
}

function readStringArray(key: string, fallback: string[]): string[] {
  if (!isBrowser) return fallback;
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const SECRET_SETTING_KEYS = [
  "openaiApiKey",
  "anthropicApiKey",
  "deepgramApiKey",
  "geminiApiKey",
  "groqApiKey",
  "mistralApiKey",
  "sonioxApiKey",
  "bailianApiKey",
  "customTranscriptionApiKey",
  "customReasoningApiKey",
] as const;

type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];
type ApiKeyCacheProvider =
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "mistral"
  | "soniox"
  | "custom"
  | "bailian";

const SECRET_SETTING_CACHE_PROVIDERS: Record<SecretSettingKey, ApiKeyCacheProvider | undefined> = {
  openaiApiKey: "openai",
  anthropicApiKey: "anthropic",
  deepgramApiKey: undefined,
  geminiApiKey: "gemini",
  groqApiKey: "groq",
  mistralApiKey: "mistral",
  sonioxApiKey: "soniox",
  bailianApiKey: "bailian",
  customTranscriptionApiKey: undefined,
  customReasoningApiKey: "custom",
};

function isSecretSettingKey(key: string): key is SecretSettingKey {
  return SECRET_SETTING_KEYS.includes(key as SecretSettingKey);
}

function readLegacySecretSettings(): Record<SecretSettingKey, string> {
  if (!isBrowser) {
    return {
      openaiApiKey: "",
      anthropicApiKey: "",
      deepgramApiKey: "",
      geminiApiKey: "",
      groqApiKey: "",
      mistralApiKey: "",
      sonioxApiKey: "",
      bailianApiKey: "",
      customTranscriptionApiKey: "",
      customReasoningApiKey: "",
    };
  }

  return {
    openaiApiKey: localStorage.getItem("openaiApiKey") ?? "",
    anthropicApiKey: localStorage.getItem("anthropicApiKey") ?? "",
    deepgramApiKey: localStorage.getItem("deepgramApiKey") ?? "",
    geminiApiKey: localStorage.getItem("geminiApiKey") ?? "",
    groqApiKey: localStorage.getItem("groqApiKey") ?? "",
    mistralApiKey: localStorage.getItem("mistralApiKey") ?? "",
    sonioxApiKey: localStorage.getItem("sonioxApiKey") ?? "",
    bailianApiKey: localStorage.getItem("bailianApiKey") ?? "",
    customTranscriptionApiKey: localStorage.getItem("customTranscriptionApiKey") ?? "",
    customReasoningApiKey: localStorage.getItem("customReasoningApiKey") ?? "",
  };
}

function clearLegacySecretSettings(keys: readonly SecretSettingKey[] = SECRET_SETTING_KEYS): void {
  if (!isBrowser) return;
  for (const key of keys) {
    localStorage.removeItem(key);
  }
}

const INITIAL_CLOUD_TRANSCRIPTION_SETTINGS = normalizeCloudTranscriptionProviderSettings({
  cloudTranscriptionProvider: readString("cloudTranscriptionProvider", "openai"),
  cloudTranscriptionModel: readString("cloudTranscriptionModel", "gpt-4o-mini-transcribe"),
  cloudTranscriptionBaseUrl: readString(
    "cloudTranscriptionBaseUrl",
    API_ENDPOINTS.TRANSCRIPTION_BASE
  ),
  customTranscriptionApiKey: "",
  bailianApiKey: "",
});

const BOOLEAN_SETTINGS = new Set([
  "useLocalWhisper",
  "allowOpenAIFallback",
  "allowLocalFallback",
  "assemblyAiStreaming",
  "deepgramStreamingEnabled",
  "sonioxRealtimeEnabled",
  "useReasoningModel",
  "voiceAssistantEnabled",
  "bailianReasoningEnableThinking",
  "customReasoningEnableThinking",
  "preferBuiltInMic",
  "cloudBackupEnabled",
  "audioCuesEnabled",
  "isSignedIn",
]);

const ARRAY_SETTINGS = new Set(["customDictionary"]);

const LANGUAGE_MIGRATIONS: Record<string, string> = { zh: "zh-CN" };

function migratePreferredLanguage() {
  if (!isBrowser) return;
  const stored = localStorage.getItem("preferredLanguage");
  if (stored && LANGUAGE_MIGRATIONS[stored]) {
    localStorage.setItem("preferredLanguage", LANGUAGE_MIGRATIONS[stored]);
  }
}

migratePreferredLanguage();

export interface SettingsState
  extends
    TranscriptionSettings,
    ReasoningSettings,
    HotkeySettings,
    MicrophoneSettings,
    ApiKeySettings,
    PrivacySettings,
    ThemeSettings {
  isSignedIn: boolean;
  audioCuesEnabled: boolean;

  setUseLocalWhisper: (value: boolean) => void;
  setWhisperModel: (value: string) => void;
  setLocalTranscriptionProvider: (value: LocalTranscriptionProvider) => void;
  setParakeetModel: (value: string) => void;
  setAllowOpenAIFallback: (value: boolean) => void;
  setAllowLocalFallback: (value: boolean) => void;
  setFallbackWhisperModel: (value: string) => void;
  setPreferredLanguage: (value: string) => void;
  setCloudTranscriptionProvider: (value: string) => void;
  setCloudTranscriptionModel: (value: string) => void;
  setCloudTranscriptionBaseUrl: (value: string) => void;
  setCloudTranscriptionMode: (value: string) => void;
  setCloudReasoningMode: (value: string) => void;
  setCloudReasoningBaseUrl: (value: string) => void;
  setBailianReasoningEnableThinking: (value: boolean) => void;
  setCustomReasoningEnableThinking: (value: boolean) => void;
  setCustomDictionary: (words: string[]) => void;
  setAssemblyAiStreaming: (value: boolean) => void;
  setDeepgramStreamingEnabled: (value: boolean) => void;
  setSonioxRealtimeEnabled: (value: boolean) => void;
  setUseReasoningModel: (value: boolean) => void;
  setVoiceAssistantEnabled: (value: boolean) => void;
  setReasoningModel: (value: string) => void;
  setReasoningProvider: (value: string) => void;
  setUiLanguage: (language: string) => void;

  setOpenaiApiKey: (key: string) => void;
  setAnthropicApiKey: (key: string) => void;
  setDeepgramApiKey: (key: string) => void;
  setGeminiApiKey: (key: string) => void;
  setGroqApiKey: (key: string) => void;
  setMistralApiKey: (key: string) => void;
  setSonioxApiKey: (key: string) => void;
  setBailianApiKey: (key: string) => void;
  setCustomTranscriptionApiKey: (key: string) => void;
  setCustomReasoningApiKey: (key: string) => void;

  setDictationKey: (key: string) => void;

  setPreferBuiltInMic: (value: boolean) => void;
  setSelectedMicDeviceId: (value: string) => void;

  setTheme: (value: "light" | "dark" | "auto") => void;
  setCloudBackupEnabled: (value: boolean) => void;
  setAudioCuesEnabled: (value: boolean) => void;
  setIsSignedIn: (value: boolean) => void;

  updateTranscriptionSettings: (settings: Partial<TranscriptionSettings>) => void;
  updateReasoningSettings: (settings: Partial<ReasoningSettings>) => void;
  updateApiKeys: (keys: Partial<ApiKeySettings>) => void;
}

function createStringSetter(key: string) {
  return (value: string) => {
    if (isBrowser) localStorage.setItem(key, value);
    useSettingsStore.setState({ [key]: value });
  };
}

function createBooleanSetter(key: string) {
  return (value: boolean) => {
    if (isBrowser) localStorage.setItem(key, String(value));
    useSettingsStore.setState({ [key]: value });
  };
}

let envPersistTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedPersistToEnv() {
  if (!isBrowser) return;
  if (envPersistTimer) clearTimeout(envPersistTimer);
  envPersistTimer = setTimeout(() => {
    window.electronAPI?.saveAllKeysToEnv?.().catch((err) => {
      logger.warn(
        "Failed to persist API keys to .env",
        { error: (err as Error).message },
        "settings"
      );
    });
  }, 1000);
}

function invalidateApiKeyCaches(provider?: ApiKeyCacheProvider, options: { persistToEnv?: boolean } = {}) {
  if (provider) {
    if (_ReasoningService) {
      _ReasoningService.clearApiKeyCache(provider);
    } else {
      import("../services/ReasoningService")
        .then((mod) => {
          _ReasoningService = mod.default;
          _ReasoningService.clearApiKeyCache(provider);
        })
        .catch(() => {});
    }
  }
  if (isBrowser) window.dispatchEvent(new Event("api-key-changed"));
  if (options.persistToEnv !== false) {
    debouncedPersistToEnv();
  }
}

function setSecretState(key: SecretSettingKey, value: string): void {
  useSettingsStore.setState({ [key]: value } as Pick<SettingsState, SecretSettingKey>);
}

async function persistSecretSetting(key: SecretSettingKey, value: string): Promise<void> {
  if (!isBrowser || !window.electronAPI) return;

  switch (key) {
    case "openaiApiKey":
      await window.electronAPI.saveOpenAIKey?.(value);
      return;
    case "anthropicApiKey":
      await window.electronAPI.saveAnthropicKey?.(value);
      return;
    case "deepgramApiKey":
      await window.electronAPI.saveDeepgramKey?.(value);
      return;
    case "geminiApiKey":
      await window.electronAPI.saveGeminiKey?.(value);
      return;
    case "groqApiKey":
      await window.electronAPI.saveGroqKey?.(value);
      return;
    case "mistralApiKey":
      await window.electronAPI.saveMistralKey?.(value);
      return;
    case "sonioxApiKey":
      await window.electronAPI.saveSonioxKey?.(value);
      return;
    case "bailianApiKey":
      await window.electronAPI.saveBailianKey?.(value);
      return;
    case "customTranscriptionApiKey":
      await window.electronAPI.saveCustomTranscriptionKey?.(value);
      return;
    case "customReasoningApiKey":
      await window.electronAPI.saveCustomReasoningKey?.(value);
      return;
  }
}

async function readPersistedSecretSetting(key: SecretSettingKey): Promise<string> {
  if (!isBrowser || !window.electronAPI) return "";

  switch (key) {
    case "openaiApiKey":
      return (await window.electronAPI.getOpenAIKey?.()) || "";
    case "anthropicApiKey":
      return (await window.electronAPI.getAnthropicKey?.()) || "";
    case "deepgramApiKey":
      return (await window.electronAPI.getDeepgramKey?.()) || "";
    case "geminiApiKey":
      return (await window.electronAPI.getGeminiKey?.()) || "";
    case "groqApiKey":
      return (await window.electronAPI.getGroqKey?.()) || "";
    case "mistralApiKey":
      return (await window.electronAPI.getMistralKey?.()) || "";
    case "sonioxApiKey":
      return (await window.electronAPI.getSonioxKey?.()) || "";
    case "bailianApiKey":
      return (await window.electronAPI.getBailianKey?.()) || "";
    case "customTranscriptionApiKey":
      return (await window.electronAPI.getCustomTranscriptionKey?.()) || "";
    case "customReasoningApiKey":
      return (await window.electronAPI.getCustomReasoningKey?.()) || "";
  }
}

async function applySecretSetting(
  key: SecretSettingKey,
  value: string,
  options: { persistToMain?: boolean; persistToEnv?: boolean } = {}
): Promise<void> {
  setSecretState(key, value);

  if (options.persistToMain !== false) {
    await persistSecretSetting(key, value);
  }

  invalidateApiKeyCaches(SECRET_SETTING_CACHE_PROVIDERS[key], {
    persistToEnv: options.persistToEnv,
  });
}

function createSecretSetter(key: SecretSettingKey) {
  return (value: string) => {
    void applySecretSetting(key, value).catch((err) => {
      logger.warn(
        "Failed to persist API key to main process",
        { key, error: (err as Error).message },
        "settings"
      );
    });
  };
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  uiLanguage: normalizeUiLanguage(readString("uiLanguage", "zh-CN")),
  useLocalWhisper: readBoolean("useLocalWhisper", false),
  whisperModel: readString("whisperModel", "base"),
  localTranscriptionProvider: (readString("localTranscriptionProvider", "whisper") === "nvidia"
    ? "nvidia"
    : "whisper") as LocalTranscriptionProvider,
  parakeetModel: readString("parakeetModel", ""),
  allowOpenAIFallback: readBoolean("allowOpenAIFallback", false),
  allowLocalFallback: readBoolean("allowLocalFallback", false),
  fallbackWhisperModel: readString("fallbackWhisperModel", "base"),
  preferredLanguage: readString("preferredLanguage", "auto"),
  cloudTranscriptionProvider: INITIAL_CLOUD_TRANSCRIPTION_SETTINGS.cloudTranscriptionProvider,
  cloudTranscriptionModel:
    INITIAL_CLOUD_TRANSCRIPTION_SETTINGS.cloudTranscriptionModel || "gpt-4o-mini-transcribe",
  cloudTranscriptionBaseUrl:
    INITIAL_CLOUD_TRANSCRIPTION_SETTINGS.cloudTranscriptionBaseUrl ||
    API_ENDPOINTS.TRANSCRIPTION_BASE,
  cloudTranscriptionMode: normalizeCloudMode(readString("cloudTranscriptionMode", "byok")),
  cloudReasoningMode: normalizeCloudMode(readString("cloudReasoningMode", "byok")),
  cloudReasoningBaseUrl: readString("cloudReasoningBaseUrl", API_ENDPOINTS.OPENAI_BASE),
  bailianReasoningEnableThinking: readBoolean("bailianReasoningEnableThinking", false),
  customReasoningEnableThinking: readBoolean("customReasoningEnableThinking", false),
  customDictionary: readStringArray("customDictionary", []),
  assemblyAiStreaming: readBoolean("assemblyAiStreaming", true),
  deepgramStreamingEnabled: readBoolean("deepgramStreamingEnabled", false),
  sonioxRealtimeEnabled: readBoolean("sonioxRealtimeEnabled", true),

  useReasoningModel: readBoolean("useReasoningModel", true),
  voiceAssistantEnabled: readBoolean("voiceAssistantEnabled", false),
  reasoningModel: readString("reasoningModel", ""),
  reasoningProvider: readString("reasoningProvider", "openai"),

  openaiApiKey: "",
  anthropicApiKey: "",
  deepgramApiKey: "",
  geminiApiKey: "",
  groqApiKey: "",
  mistralApiKey: "",
  sonioxApiKey: "",
  bailianApiKey: INITIAL_CLOUD_TRANSCRIPTION_SETTINGS.bailianApiKey,
  customTranscriptionApiKey: "",
  customReasoningApiKey: "",

  dictationKey: readString("dictationKey", ""),

  preferBuiltInMic: readBoolean("preferBuiltInMic", true),
  selectedMicDeviceId: readString("selectedMicDeviceId", ""),

  theme: (() => {
    const v = readString("theme", "auto");
    if (v === "light" || v === "dark" || v === "auto") return v;
    return "auto" as const;
  })(),
  cloudBackupEnabled: readBoolean("cloudBackupEnabled", false),
  audioCuesEnabled: readBoolean("audioCuesEnabled", true),
  isSignedIn: CLOUD_AUTH_AVAILABLE ? readBoolean("isSignedIn", false) : false,

  setUseLocalWhisper: createBooleanSetter("useLocalWhisper"),
  setWhisperModel: createStringSetter("whisperModel"),
  setLocalTranscriptionProvider: (value: LocalTranscriptionProvider) => {
    if (isBrowser) localStorage.setItem("localTranscriptionProvider", value);
    set({ localTranscriptionProvider: value });
  },
  setParakeetModel: createStringSetter("parakeetModel"),
  setAllowOpenAIFallback: createBooleanSetter("allowOpenAIFallback"),
  setAllowLocalFallback: createBooleanSetter("allowLocalFallback"),
  setFallbackWhisperModel: createStringSetter("fallbackWhisperModel"),
  setPreferredLanguage: createStringSetter("preferredLanguage"),
  setCloudTranscriptionProvider: createStringSetter("cloudTranscriptionProvider"),
  setCloudTranscriptionModel: createStringSetter("cloudTranscriptionModel"),
  setCloudTranscriptionBaseUrl: createStringSetter("cloudTranscriptionBaseUrl"),
  setCloudTranscriptionMode: createStringSetter("cloudTranscriptionMode"),
  setCloudReasoningMode: createStringSetter("cloudReasoningMode"),
  setCloudReasoningBaseUrl: createStringSetter("cloudReasoningBaseUrl"),
  setBailianReasoningEnableThinking: createBooleanSetter("bailianReasoningEnableThinking"),
  setCustomReasoningEnableThinking: createBooleanSetter("customReasoningEnableThinking"),
  setAssemblyAiStreaming: createBooleanSetter("assemblyAiStreaming"),
  setDeepgramStreamingEnabled: createBooleanSetter("deepgramStreamingEnabled"),
  setSonioxRealtimeEnabled: createBooleanSetter("sonioxRealtimeEnabled"),
  setUseReasoningModel: createBooleanSetter("useReasoningModel"),
  setVoiceAssistantEnabled: createBooleanSetter("voiceAssistantEnabled"),
  setReasoningModel: createStringSetter("reasoningModel"),
  setReasoningProvider: createStringSetter("reasoningProvider"),

  setCustomDictionary: (words: string[]) => {
    if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(words));
    set({ customDictionary: words });
    window.electronAPI?.setDictionary(words).catch((err) => {
      logger.warn(
        "Failed to sync dictionary to SQLite",
        { error: (err as Error).message },
        "settings"
      );
    });
  },

  setUiLanguage: (language: string) => {
    const normalized = normalizeUiLanguage(language);
    if (isBrowser) localStorage.setItem("uiLanguage", normalized);
    set({ uiLanguage: normalized });
    void i18n.changeLanguage(normalized);
    if (isBrowser && window.electronAPI?.setUiLanguage) {
      window.electronAPI.setUiLanguage(normalized).catch((err) => {
        logger.warn(
          "Failed to sync UI language to main process",
          { error: (err as Error).message },
          "settings"
        );
      });
    }
  },

  setOpenaiApiKey: createSecretSetter("openaiApiKey"),
  setAnthropicApiKey: createSecretSetter("anthropicApiKey"),
  setDeepgramApiKey: createSecretSetter("deepgramApiKey"),
  setGeminiApiKey: createSecretSetter("geminiApiKey"),
  setGroqApiKey: createSecretSetter("groqApiKey"),
  setMistralApiKey: createSecretSetter("mistralApiKey"),
  setSonioxApiKey: createSecretSetter("sonioxApiKey"),
  setBailianApiKey: createSecretSetter("bailianApiKey"),
  setCustomTranscriptionApiKey: createSecretSetter("customTranscriptionApiKey"),
  setCustomReasoningApiKey: createSecretSetter("customReasoningApiKey"),

  setDictationKey: (key: string) => {
    if (isBrowser) localStorage.setItem("dictationKey", key);
    set({ dictationKey: key });
    if (isBrowser) {
      window.electronAPI?.notifyHotkeyChanged?.(key);
      window.electronAPI?.saveDictationKey?.(key);
    }
  },

  setPreferBuiltInMic: createBooleanSetter("preferBuiltInMic"),
  setSelectedMicDeviceId: createStringSetter("selectedMicDeviceId"),

  setTheme: (value: "light" | "dark" | "auto") => {
    if (isBrowser) localStorage.setItem("theme", value);
    set({ theme: value });
  },

  setCloudBackupEnabled: createBooleanSetter("cloudBackupEnabled"),
  setAudioCuesEnabled: createBooleanSetter("audioCuesEnabled"),

  setIsSignedIn: (value: boolean) => {
    if (isBrowser) localStorage.setItem("isSignedIn", String(value));
    set({ isSignedIn: value });
  },

  updateTranscriptionSettings: (settings: Partial<TranscriptionSettings>) => {
    const s = useSettingsStore.getState();
    if (settings.useLocalWhisper !== undefined) s.setUseLocalWhisper(settings.useLocalWhisper);
    if (settings.uiLanguage !== undefined) s.setUiLanguage(settings.uiLanguage);
    if (settings.whisperModel !== undefined) s.setWhisperModel(settings.whisperModel);
    if (settings.localTranscriptionProvider !== undefined)
      s.setLocalTranscriptionProvider(settings.localTranscriptionProvider);
    if (settings.parakeetModel !== undefined) s.setParakeetModel(settings.parakeetModel);
    if (settings.allowOpenAIFallback !== undefined)
      s.setAllowOpenAIFallback(settings.allowOpenAIFallback);
    if (settings.allowLocalFallback !== undefined)
      s.setAllowLocalFallback(settings.allowLocalFallback);
    if (settings.fallbackWhisperModel !== undefined)
      s.setFallbackWhisperModel(settings.fallbackWhisperModel);
    if (settings.preferredLanguage !== undefined)
      s.setPreferredLanguage(settings.preferredLanguage);
    if (settings.cloudTranscriptionProvider !== undefined)
      s.setCloudTranscriptionProvider(settings.cloudTranscriptionProvider);
    if (settings.cloudTranscriptionModel !== undefined)
      s.setCloudTranscriptionModel(settings.cloudTranscriptionModel);
    if (settings.cloudTranscriptionBaseUrl !== undefined)
      s.setCloudTranscriptionBaseUrl(settings.cloudTranscriptionBaseUrl);
    if (settings.cloudTranscriptionMode !== undefined)
      s.setCloudTranscriptionMode(settings.cloudTranscriptionMode);
    if (settings.customDictionary !== undefined) s.setCustomDictionary(settings.customDictionary);
    if (settings.assemblyAiStreaming !== undefined)
      s.setAssemblyAiStreaming(settings.assemblyAiStreaming);
    if (settings.deepgramStreamingEnabled !== undefined)
      s.setDeepgramStreamingEnabled(settings.deepgramStreamingEnabled);
    if (settings.sonioxRealtimeEnabled !== undefined)
      s.setSonioxRealtimeEnabled(settings.sonioxRealtimeEnabled);
  },

  updateReasoningSettings: (settings: Partial<ReasoningSettings>) => {
    const s = useSettingsStore.getState();
    if (settings.useReasoningModel !== undefined)
      s.setUseReasoningModel(settings.useReasoningModel);
    if (settings.voiceAssistantEnabled !== undefined)
      s.setVoiceAssistantEnabled(settings.voiceAssistantEnabled);
    if (settings.reasoningModel !== undefined) s.setReasoningModel(settings.reasoningModel);
    if (settings.reasoningProvider !== undefined)
      s.setReasoningProvider(settings.reasoningProvider);
    if (settings.cloudReasoningBaseUrl !== undefined)
      s.setCloudReasoningBaseUrl(settings.cloudReasoningBaseUrl);
    if (settings.cloudReasoningMode !== undefined)
      s.setCloudReasoningMode(settings.cloudReasoningMode);
    if (settings.bailianReasoningEnableThinking !== undefined)
      s.setBailianReasoningEnableThinking(settings.bailianReasoningEnableThinking);
    if (settings.customReasoningEnableThinking !== undefined)
      s.setCustomReasoningEnableThinking(settings.customReasoningEnableThinking);
  },

  updateApiKeys: (keys: Partial<ApiKeySettings>) => {
    const s = useSettingsStore.getState();
    if (keys.openaiApiKey !== undefined) s.setOpenaiApiKey(keys.openaiApiKey);
    if (keys.anthropicApiKey !== undefined) s.setAnthropicApiKey(keys.anthropicApiKey);
    if (keys.deepgramApiKey !== undefined) s.setDeepgramApiKey(keys.deepgramApiKey);
    if (keys.geminiApiKey !== undefined) s.setGeminiApiKey(keys.geminiApiKey);
    if (keys.groqApiKey !== undefined) s.setGroqApiKey(keys.groqApiKey);
    if (keys.mistralApiKey !== undefined) s.setMistralApiKey(keys.mistralApiKey);
    if (keys.sonioxApiKey !== undefined) s.setSonioxApiKey(keys.sonioxApiKey);
    if (keys.bailianApiKey !== undefined) s.setBailianApiKey(keys.bailianApiKey);
    if (keys.customTranscriptionApiKey !== undefined)
      s.setCustomTranscriptionApiKey(keys.customTranscriptionApiKey);
    if (keys.customReasoningApiKey !== undefined)
      s.setCustomReasoningApiKey(keys.customReasoningApiKey);
  },
}));

// --- Selectors (derived state, not stored) ---

export const selectIsCloudReasoningMode = (state: SettingsState) =>
  MOUTHPIECE_CLOUD_ENABLED &&
  CLOUD_AUTH_AVAILABLE &&
  state.isSignedIn &&
  (state.cloudReasoningMode === "mouthpiece" || state.cloudReasoningMode === "openwhispr");

export const selectEffectiveReasoningProvider = (state: SettingsState) =>
  selectIsCloudReasoningMode(state) ? "mouthpiece" : state.reasoningProvider;

// --- Convenience getters for non-React code ---

export function getSettings() {
  return useSettingsStore.getState();
}

export function getEffectiveReasoningModel() {
  const state = useSettingsStore.getState();
  if (selectIsCloudReasoningMode(state)) {
    return "";
  }
  return state.reasoningModel;
}

export function isCloudReasoningMode() {
  return selectIsCloudReasoningMode(useSettingsStore.getState());
}

// --- Initialization ---

let hasInitialized = false;

export async function initializeSettings(): Promise<void> {
  if (hasInitialized) return;
  hasInitialized = true;

  if (!isBrowser) return;

  localStorage.removeItem("activationMode");
  localStorage.removeItem("floatingIconAutoHide");

  const state = useSettingsStore.getState();

  // Migrate legacy renderer-stored secrets into the main process and
  // then sync the canonical values back into renderer memory state.
  if (window.electronAPI) {
    const legacyApiKeys = readLegacySecretSettings();
    const migratedLegacyKeys: SecretSettingKey[] = [];

    const syncSecretSetting = async (key: SecretSettingKey) => {
      const currentValue = (useSettingsStore.getState()[key] || "").trim();
      const legacyValue = (legacyApiKeys[key] || "").trim();

      if (currentValue) {
        if (legacyValue) {
          migratedLegacyKeys.push(key);
        }
        return;
      }

      if (legacyValue) {
        await applySecretSetting(key, legacyValue);
        migratedLegacyKeys.push(key);
        return;
      }
      const persistedValue = (await readPersistedSecretSetting(key)).trim();
      if (persistedValue) {
        await applySecretSetting(key, persistedValue, {
          persistToMain: false,
          persistToEnv: false,
        });
      }
    };

    for (const key of SECRET_SETTING_KEYS) {
      try {
        await syncSecretSetting(key);
      } catch (err) {
        logger.warn(
          "Failed to sync API key on startup",
          { key, error: (err as Error).message },
          "settings"
        );
      }
    }

    if (migratedLegacyKeys.length > 0) {
      clearLegacySecretSettings(migratedLegacyKeys);
    }

    const refreshedState = useSettingsStore.getState();
    const normalizedCloudTranscriptionSettings = normalizeCloudTranscriptionProviderSettings({
      cloudTranscriptionProvider: refreshedState.cloudTranscriptionProvider,
      cloudTranscriptionModel: refreshedState.cloudTranscriptionModel,
      cloudTranscriptionBaseUrl: refreshedState.cloudTranscriptionBaseUrl,
      customTranscriptionApiKey: refreshedState.customTranscriptionApiKey,
      bailianApiKey: refreshedState.bailianApiKey,
    });
    if (
      normalizedCloudTranscriptionSettings.cloudTranscriptionProvider !==
      refreshedState.cloudTranscriptionProvider
    ) {
      refreshedState.setCloudTranscriptionProvider(
        normalizedCloudTranscriptionSettings.cloudTranscriptionProvider
      );
    }
    if (
      normalizedCloudTranscriptionSettings.cloudTranscriptionModel &&
      normalizedCloudTranscriptionSettings.cloudTranscriptionModel !==
        refreshedState.cloudTranscriptionModel
    ) {
      refreshedState.setCloudTranscriptionModel(
        normalizedCloudTranscriptionSettings.cloudTranscriptionModel
      );
    }
    if (
      normalizedCloudTranscriptionSettings.bailianApiKey &&
      normalizedCloudTranscriptionSettings.bailianApiKey !== refreshedState.bailianApiKey
    ) {
      refreshedState.setBailianApiKey(normalizedCloudTranscriptionSettings.bailianApiKey);
    }

    const hasExplicitCloudMode = Boolean(localStorage.getItem("cloudTranscriptionMode"));
    const hasEnvOrStoredByokKey = hasAnyByokKey([
      useSettingsStore.getState().openaiApiKey,
      useSettingsStore.getState().deepgramApiKey,
      useSettingsStore.getState().bailianApiKey,
      useSettingsStore.getState().groqApiKey,
      useSettingsStore.getState().mistralApiKey,
      useSettingsStore.getState().sonioxApiKey,
      useSettingsStore.getState().customTranscriptionApiKey,
    ]);

    if (!CLOUD_AUTH_AVAILABLE) {
      if (refreshedState.cloudTranscriptionMode !== "byok") {
        createStringSetter("cloudTranscriptionMode")("byok");
      }
      if (refreshedState.cloudReasoningMode !== "byok") {
        createStringSetter("cloudReasoningMode")("byok");
      }
      if (refreshedState.isSignedIn) {
        createBooleanSetter("isSignedIn")(false);
      }
    } else if (
      !hasExplicitCloudMode &&
      hasEnvOrStoredByokKey &&
      refreshedState.cloudTranscriptionMode !== "byok"
    ) {
      createStringSetter("cloudTranscriptionMode")("byok");
    }

    // Sync dictation key from main process
    try {
      const envKey = await window.electronAPI.getDictationKey?.();
      if (envKey && envKey !== state.dictationKey) {
        createStringSetter("dictationKey")(envKey);
      }
    } catch (err) {
      logger.warn(
        "Failed to sync dictation key on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    // Sync UI language from main process
    try {
      const envLanguage = await window.electronAPI.getUiLanguage?.();
      const resolved = normalizeUiLanguage(envLanguage || state.uiLanguage);
      if (resolved !== state.uiLanguage) {
        if (isBrowser) localStorage.setItem("uiLanguage", resolved);
        useSettingsStore.setState({ uiLanguage: resolved });
      }
      await i18n.changeLanguage(resolved);
    } catch (err) {
      logger.warn(
        "Failed to sync UI language on startup",
        { error: (err as Error).message },
        "settings"
      );
      void i18n.changeLanguage(normalizeUiLanguage(state.uiLanguage));
    }

    const migratedLang = isBrowser ? localStorage.getItem("preferredLanguage") : null;
    if (migratedLang && migratedLang !== state.preferredLanguage) {
      useSettingsStore.setState({ preferredLanguage: migratedLang });
    }

    // Sync dictionary from SQLite <-> localStorage
    try {
      if (window.electronAPI.getDictionary) {
        const currentDictionary = useSettingsStore.getState().customDictionary;
        const dbWords = await window.electronAPI.getDictionary();
        if (dbWords.length === 0 && currentDictionary.length > 0) {
          await window.electronAPI.setDictionary(currentDictionary);
        } else if (dbWords.length > 0 && currentDictionary.length === 0) {
          if (isBrowser) localStorage.setItem("customDictionary", JSON.stringify(dbWords));
          useSettingsStore.setState({ customDictionary: dbWords });
        }
      }
    } catch (err) {
      logger.warn(
        "Failed to sync dictionary on startup",
        { error: (err as Error).message },
        "settings"
      );
    }

    ensureAgentNameInDictionary();
  }

  // Sync Zustand store when another window writes to localStorage
  window.addEventListener("storage", (event) => {
    if (!event.key || event.storageArea !== localStorage || event.newValue === null) return;

    const { key, newValue } = event;
    if (isSecretSettingKey(key)) return;
    const state = useSettingsStore.getState();
    if (!(key in state) || typeof (state as unknown as Record<string, unknown>)[key] === "function")
      return;

    let value: unknown;
    if (BOOLEAN_SETTINGS.has(key)) {
      value = newValue === "true";
    } else if (ARRAY_SETTINGS.has(key)) {
      try {
        const parsed = JSON.parse(newValue);
        value = Array.isArray(parsed) ? parsed : [];
      } catch {
        value = [];
      }
    } else {
      value = newValue;
    }

    useSettingsStore.setState({ [key]: value });

    if (key === "uiLanguage" && typeof value === "string") {
      void i18n.changeLanguage(value);
    }
  });
}
