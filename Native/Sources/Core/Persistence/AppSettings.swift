import Foundation

enum UILanguage: String, Codable, CaseIterable, Sendable {
    case simplifiedChinese = "zh-CN"
    case traditionalChinese = "zh-TW"
    case english = "en"
    case system = "system"
}

enum AppTheme: String, Codable, CaseIterable, Sendable {
    case light
    case dark
    case system = "auto"
}

enum LocalTranscriptionProvider: String, Codable, CaseIterable, Sendable {
    case whisper
    case parakeet = "nvidia"
    case qwen
}

enum HotkeyBehavior: String, Codable, CaseIterable, Sendable {
    case automatic
    case toggle
    case pushToTalk
}

struct TerminologyProfile: Codable, Equatable, Sendable {
    var preferredTerms: [String] = []
    var avoidedTerms: [String] = []
    var replacementRules: [String: String] = [:]

    mutating func normalize() {
        preferredTerms = Self.uniqueTrimmed(preferredTerms)
        avoidedTerms = Self.uniqueTrimmed(avoidedTerms)
        replacementRules = Dictionary(
            uniqueKeysWithValues: replacementRules.compactMap { key, value in
                let cleanKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
                let cleanValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return cleanKey.isEmpty || cleanValue.isEmpty ? nil : (cleanKey, cleanValue)
            }
        )
    }

    private static func uniqueTrimmed(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !clean.isEmpty, seen.insert(clean.lowercased()).inserted else { return nil }
            return clean
        }
    }
}

struct AppSettings: Codable, Equatable, Sendable {
    var uiLanguage: UILanguage = .simplifiedChinese
    var theme: AppTheme = .system

    var dictationKey = "RightCommand"
    var hotkeyBehavior: HotkeyBehavior = .automatic
    var translationDictationKey = ""
    var selectedMicrophoneUID = ""
    var launchAtLogin = false
    var showInDock = true
    var showInMenuBar = true
    var escapeCancelsRecording = true
    var pauseOtherMediaDuringDictation = false
    var audioCuesEnabled = true
    var soundPreset = "classic"

    var useLocalTranscription = false
    var localTranscriptionProvider: LocalTranscriptionProvider = .whisper
    var whisperModel = "base"
    var parakeetModel = ""
    var qwenASRModel = "qwen3-asr-0.6b-mlx"
    var allowCloudFallback = false
    var allowLocalFallback = false
    var fallbackWhisperModel = "base"

    var preferredLanguage = "auto"
    var cloudTranscriptionProvider = "openai"
    var cloudTranscriptionModel = "gpt-4o-mini-transcribe"
    var cloudTranscriptionBaseURL = "https://api.openai.com/v1"
    var assemblyAIStreaming = true
    var deepgramStreamingEnabled = false
    var sonioxRealtimeEnabled = true
    var bailianRealtimeEnabled = false

    var useReasoningModel = true
    var reasoningProvider = "openai"
    var reasoningModel = ""
    var reasoningBaseURL = "https://api.openai.com/v1"
    var bailianReasoningEnableThinking = false
    var customReasoningEnableThinking = false
    var translationEnabled = false
    var translationTargetLanguage = ""

    var terminologyProfile = TerminologyProfile()
    var customPrompt = ""
    var cloudBackupEnabled = false
    var sensitiveAppProtectionEnabled = true
    var sensitiveAppBlockInsertion = true
    var allowSensitiveAppCloudReasoning = false
    var allowSensitiveAppPasteMonitoring = false
    var debugLoggingEnabled = false
    var onboardingCompleted = false

    mutating func normalize() {
        if dictationKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            dictationKey = "RightCommand"
        }
        cloudTranscriptionBaseURL = Self.normalizedURL(
            cloudTranscriptionBaseURL,
            fallback: "https://api.openai.com/v1"
        )
        reasoningBaseURL = Self.normalizedURL(
            reasoningBaseURL,
            fallback: "https://api.openai.com/v1"
        )
        terminologyProfile.normalize()
    }

    private static func normalizedURL(_ value: String, fallback: String) -> String {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: clean), url.scheme == "https" || url.scheme == "http" else {
            return fallback
        }
        return clean.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}

enum CredentialAccount: String, CaseIterable, Sendable {
    case openAI = "openai-api-key"
    case anthropic = "anthropic-api-key"
    case deepgram = "deepgram-api-key"
    case gemini = "gemini-api-key"
    case groq = "groq-api-key"
    case mistral = "mistral-api-key"
    case soniox = "soniox-api-key"
    case bailian = "bailian-api-key"
    case assemblyAI = "assemblyai-api-key"
    case customTranscription = "custom-transcription-api-key"
    case customReasoning = "custom-reasoning-api-key"
}
