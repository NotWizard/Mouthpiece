import Foundation

@MainActor
final class SettingsRepository {
    private static let storageKey = "native.settings.v1"
    private let defaults: UserDefaults
    private var cached: AppSettings

    init(defaults: UserDefaults? = nil) {
        let defaults = defaults ?? Self.defaultStore()
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.storageKey),
           var decoded = Self.decodeWithDefaults(data) {
            decoded.normalize()
            cached = decoded
        } else {
            cached = AppSettings()
        }
    }

    private static func defaultStore() -> UserDefaults {
        guard ProcessInfo.processInfo.environment["MOUTHPIECE_DATA_ROOT"] != nil else {
            return .standard
        }
        let suite = "com.mouthpiece.app.automation.\(ProcessInfo.processInfo.processIdentifier)"
        return UserDefaults(suiteName: suite) ?? .standard
    }

    func load() -> AppSettings {
        cached
    }

    func save(_ settings: AppSettings) throws {
        var normalized = settings
        normalized.normalize()
        let data = try JSONEncoder().encode(normalized)
        defaults.set(data, forKey: Self.storageKey)
        cached = normalized
    }

    func update(_ mutation: (inout AppSettings) -> Void) throws -> AppSettings {
        var next = cached
        mutation(&next)
        try save(next)
        return cached
    }

    func importLegacyValues(_ values: [String: String], onlyWhenMissing: Bool = true) throws {
        var next = cached
        let hasNativeSettings = defaults.data(forKey: Self.storageKey) != nil
        guard !onlyWhenMissing || !hasNativeSettings else { return }

        next.uiLanguage = UILanguage(rawValue: values["uiLanguage"] ?? values["UI_LANGUAGE"] ?? "")
            ?? next.uiLanguage
        next.theme = AppTheme(rawValue: values["theme"] ?? "") ?? next.theme
        next.dictationKey = values["dictationKey"] ?? values["DICTATION_KEY"] ?? next.dictationKey
        if let legacyTranslationKey = values["translationDictationKey"],
           let suffix = TranslationHotkey.suffix(from: legacyTranslationKey) {
            next.translationHotkeySuffix = suffix
        }
        next.preferredLanguage = values["preferredLanguage"] ?? next.preferredLanguage
        next.selectedMicrophoneUID = values["selectedMicDeviceId"]
            ?? values["selectedMicDeviceUID"]
            ?? next.selectedMicrophoneUID
        next.localTranscriptionProvider = LocalTranscriptionProvider(
            rawValue: values["localTranscriptionProvider"] ?? ""
        ) ?? next.localTranscriptionProvider
        next.whisperModel = values["whisperModel"] ?? next.whisperModel
        next.parakeetModel = values["parakeetModel"] ?? next.parakeetModel
        next.qwenASRModel = values["qwenAsrModel"] ?? next.qwenASRModel
        next.fallbackWhisperModel = values["fallbackWhisperModel"] ?? next.fallbackWhisperModel
        next.cloudTranscriptionProvider = values["cloudTranscriptionProvider"]
            ?? next.cloudTranscriptionProvider
        next.cloudTranscriptionModel = values["cloudTranscriptionModel"]
            ?? next.cloudTranscriptionModel
        next.cloudTranscriptionBaseURL = values["cloudTranscriptionBaseUrl"]
            ?? values["OPENAI_API_BASE"]
            ?? next.cloudTranscriptionBaseURL
        next.reasoningProvider = values["reasoningProvider"] ?? next.reasoningProvider
        next.reasoningModel = values["reasoningModel"] ?? next.reasoningModel
        next.reasoningBaseURL = values["cloudReasoningBaseUrl"] ?? next.reasoningBaseURL
        next.translationTargetLanguage = values["translationTargetLang"]
            ?? next.translationTargetLanguage
        next.soundPreset = values["soundPreset"] ?? next.soundPreset
        next.bailianRealtimeEnabled = Self.bool(values["bailianRealtimeEnabled"])
            ?? next.bailianRealtimeEnabled
        next.deepgramStreamingEnabled = Self.bool(values["deepgramStreamingEnabled"])
            ?? next.deepgramStreamingEnabled
        next.sonioxRealtimeEnabled = Self.bool(values["sonioxRealtimeEnabled"])
            ?? next.sonioxRealtimeEnabled
        next.assemblyAIStreaming = Self.bool(values["assemblyAiStreaming"])
            ?? next.assemblyAIStreaming
        next.useLocalTranscription = Self.bool(values["useLocalWhisper"])
            ?? next.useLocalTranscription
        next.allowCloudFallback = Self.bool(values["allowOpenAIFallback"])
            ?? Self.bool(values["allowCloudFallback"])
            ?? next.allowCloudFallback
        next.allowLocalFallback = Self.bool(values["allowLocalFallback"])
            ?? next.allowLocalFallback
        next.useReasoningModel = Self.bool(values["useReasoningModel"])
            ?? next.useReasoningModel
        next.bailianReasoningEnableThinking = Self.bool(values["bailianReasoningEnableThinking"])
            ?? next.bailianReasoningEnableThinking
        next.customReasoningEnableThinking = Self.bool(values["customReasoningEnableThinking"])
            ?? next.customReasoningEnableThinking
        next.translationEnabled = Self.bool(values["translationEnabled"])
            ?? next.translationEnabled
        next.cloudBackupEnabled = Self.bool(values["cloudBackupEnabled"])
            ?? next.cloudBackupEnabled
        next.sensitiveAppProtectionEnabled = Self.bool(values["sensitiveAppProtectionEnabled"])
            ?? next.sensitiveAppProtectionEnabled
        next.sensitiveAppBlockInsertion = Self.bool(values["sensitiveAppBlockInsertion"])
            ?? next.sensitiveAppBlockInsertion
        next.allowSensitiveAppCloudReasoning = Self.bool(values["allowSensitiveAppCloudReasoning"])
            ?? next.allowSensitiveAppCloudReasoning
        next.allowSensitiveAppPasteMonitoring = Self.bool(values["allowSensitiveAppPasteMonitoring"])
            ?? next.allowSensitiveAppPasteMonitoring
        next.audioCuesEnabled = Self.bool(values["audioCuesEnabled"])
            ?? next.audioCuesEnabled
        next.debugLoggingEnabled = Self.bool(values["debugMode"])
            ?? next.debugLoggingEnabled
        next.onboardingCompleted = Self.bool(values["onboardingCompleted"])
            ?? next.onboardingCompleted
        if let prompt = Self.decodedJSONString(values["customCleanupPrompt"]), !prompt.isEmpty {
            next.customPrompt = prompt
        }
        if let profile = Self.terminologyProfile(values["terminologyProfile"]) {
            next.terminologyProfile = profile
        } else if let dictionary = Self.stringArray(values["customDictionary"]), !dictionary.isEmpty {
            next.terminologyProfile.preferredTerms = dictionary
        }
        try save(next)
    }

    func migrationBackup() -> Data? {
        defaults.data(forKey: Self.storageKey)
    }

    func persistedSettingsForMigration() -> AppSettings? {
        guard let data = defaults.data(forKey: Self.storageKey) else { return nil }
        return Self.decodeWithDefaults(data)
    }

    func restoreMigrationBackup(_ data: Data?) {
        if let data, var restored = Self.decodeWithDefaults(data) {
            restored.normalize()
            defaults.set(data, forKey: Self.storageKey)
            cached = restored
        } else {
            defaults.removeObject(forKey: Self.storageKey)
            cached = AppSettings()
        }
    }

    private static func bool(_ value: String?) -> Bool? {
        guard let value else { return nil }
        switch value.lowercased() {
        case "1", "true", "yes", "on": return true
        case "0", "false", "no", "off": return false
        default: return nil
        }
    }

    private static func decodeWithDefaults(_ data: Data) -> AppSettings? {
        guard var defaults = try? JSONSerialization.jsonObject(
            with: JSONEncoder().encode(AppSettings())
        ) as? [String: Any],
        let stored = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let combined = merge(defaults: defaults, stored: stored)
        guard let merged = try? JSONSerialization.data(withJSONObject: combined) else { return nil }
        return try? JSONDecoder().decode(AppSettings.self, from: merged)
    }

    private static func merge(
        defaults: [String: Any],
        stored: [String: Any]
    ) -> [String: Any] {
        var combined = defaults
        for (key, value) in stored {
            if let defaultObject = defaults[key] as? [String: Any],
               let storedObject = value as? [String: Any] {
                combined[key] = merge(defaults: defaultObject, stored: storedObject)
            } else {
                combined[key] = value
            }
        }
        return combined
    }

    private static func decodedJSONString(_ value: String?) -> String? {
        guard let value else { return nil }
        if let data = value.data(using: .utf8),
           let decoded = try? JSONSerialization.jsonObject(with: data) as? String {
            return decoded.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func stringArray(_ value: String?) -> [String]? {
        guard let data = value?.data(using: .utf8),
              let values = try? JSONSerialization.jsonObject(with: data) as? [String] else {
            return nil
        }
        return values
    }

    private static func terminologyProfile(_ value: String?) -> TerminologyProfile? {
        guard let data = value?.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let preferred = (object["preferredTerms"] as? [String] ?? [])
            + (object["glossaryTerms"] as? [String] ?? [])
        let avoided = object["blacklistedTerms"] as? [String] ?? []
        let mappings = object["homophoneMappings"] as? [[String: Any]] ?? []
        var replacements: [String: String] = [:]
        for item in mappings {
            guard let source = item["source"] as? String,
                  let target = item["target"] as? String,
                  !source.isEmpty, !target.isEmpty else { continue }
            replacements[source] = target
        }
        var profile = TerminologyProfile(
            preferredTerms: preferred,
            avoidedTerms: avoided,
            replacementRules: replacements
        )
        profile.normalize()
        return profile
    }
}
