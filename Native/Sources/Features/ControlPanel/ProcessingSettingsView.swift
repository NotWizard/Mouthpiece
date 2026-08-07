import SwiftUI

struct ProcessingSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var showingPromptStudio = false

    var body: some View {
        SettingsPage(title: "processing.title", subtitle: "processing.subtitle") {
            SettingsSection(title: "processing.cleanup") {
                SettingsRow(
                    icon: "wand.and.stars",
                    title: "processing.enableCleanup",
                    showsDivider: false
                ) {
                    Toggle("", isOn: cleanupEnabledBinding)
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .controlSize(.small)
                }
            }

            if environment.settings.useReasoningModel {
                providerSelection
                SettingsSection(title: "processing.configuration") {
                    reasoningRows
                }

                SettingsSection(title: "personalization.instructions") {
                    SettingsRow(
                        icon: "text.quote",
                        title: "promptStudio.summary",
                        detail: environment.settings.customPrompt.isEmpty
                            ? "promptStudio.usingDefault"
                            : "promptStudio.usingCustom",
                        showsDivider: false
                    ) {
                        Button("promptStudio.open") {
                            showingPromptStudio = true
                        }
                    }
                }
            }

            SettingsSection(title: "processing.translation") {
                SettingsRow(
                    icon: "translate",
                    title: "processing.enableTranslation",
                    detail: "processing.translationRequiresCleanup",
                    showsDivider: environment.settings.translationEnabled
                ) {
                    Toggle("", isOn: translationEnabledBinding)
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .controlSize(.small)
                }
                if environment.settings.translationEnabled {
                    SettingsRow(
                        icon: "keyboard",
                        title: "processing.translationHotkey",
                        detail: supportsTranslationSuffix ? nil : "processing.translationHotkeyRequiresModifier"
                    ) {
                        TranslationHotkeyRecorder(
                            suffix: settingBinding(environment, \.translationHotkeySuffix)
                        )
                        .disabled(!supportsTranslationSuffix)
                    }
                    SettingsRow(icon: "globe", title: "processing.targetLanguage", showsDivider: false) {
                        Picker("", selection: settingBinding(environment, \.translationTargetLanguage)) {
                            ForEach(targetLanguages, id: \.value) { language in
                                Text(language.key).tag(language.value)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 170, alignment: .trailing)
                    }
                }
            }

        }
        .sheet(isPresented: $showingPromptStudio) {
            PromptStudioSheet()
                .environmentObject(environment)
        }
    }

    private var providerSelection: some View {
        ProviderSelectionGrid(
            title: "processing.provider",
            providers: reasoningProviders,
            selectedID: environment.settings.reasoningProvider
        ) { provider in
            var settings = environment.settings
            settings.reasoningProvider = provider
            environment.saveSettings(settings)
        }
        .task(id: environment.settings.reasoningProvider) {
            applyDefaults(for: environment.settings.reasoningProvider)
        }
    }

    private var reasoningProviders: [ProviderChoice] {
        [
            .init(id: "openai", title: "provider.openai", assetName: "provider-openai", fallbackIcon: "sparkles"),
            .init(id: "bailian", title: "provider.bailian", assetName: "provider-alibaba-cloud", fallbackIcon: "cloud", rendersAsTemplate: false),
            .init(id: "anthropic", title: "provider.anthropic", assetName: "provider-anthropic", fallbackIcon: "text.bubble"),
            .init(id: "gemini", title: "provider.gemini", assetName: "provider-gemini", fallbackIcon: "diamond", rendersAsTemplate: false),
            .init(id: "groq", title: "provider.groq", assetName: "provider-groq", fallbackIcon: "bolt", rendersAsTemplate: false),
            .init(id: "custom", title: "provider.custom", assetName: nil, fallbackIcon: "slider.horizontal.3"),
        ]
    }

    @ViewBuilder
    private var reasoningRows: some View {
        CredentialEditor(account: reasoningCredential, showsDivider: true)
            .id(reasoningCredential)
        SettingsRow(
            icon: "cube",
            title: "processing.model",
            showsDivider: environment.settings.reasoningProvider == "bailian"
                || environment.settings.reasoningProvider == "custom"
        ) {
            DeferredSettingTextField(
                "speech.model.placeholder",
                value: environment.settings.reasoningModel,
                keyPath: \.reasoningModel,
                width: SettingsControlMetrics.configurationFieldWidth
            )
        }
        if environment.settings.reasoningProvider == "custom" {
            SettingsRow(icon: "link", title: "processing.baseURL") {
                DeferredSettingTextField(
                    "http://127.0.0.1:8080/v1",
                    value: environment.settings.reasoningBaseURL,
                    keyPath: \.reasoningBaseURL,
                    width: 280
                )
            }
        }
        if environment.settings.reasoningProvider == "bailian" {
            SettingsRow(icon: "brain", title: "processing.enableThinking", showsDivider: false) {
                Toggle("", isOn: settingBinding(environment, \.bailianReasoningEnableThinking))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
        } else if environment.settings.reasoningProvider == "custom" {
            SettingsRow(icon: "brain", title: "processing.enableThinking", showsDivider: false) {
                Toggle("", isOn: settingBinding(environment, \.customReasoningEnableThinking))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
        }
    }

    private var reasoningCredential: CredentialAccount {
        switch environment.settings.reasoningProvider {
        case "bailian": .bailian
        case "anthropic": .anthropic
        case "gemini": .gemini
        case "groq": .groq
        case "custom": .customReasoning
        default: .openAI
        }
    }

    private var supportsTranslationSuffix: Bool {
        TranslationHotkey.combination(
            dictationKey: environment.settings.dictationKey,
            suffix: environment.settings.translationHotkeySuffix
        ) != nil
    }

    private var cleanupEnabledBinding: Binding<Bool> {
        Binding(
            get: { environment.settings.useReasoningModel },
            set: { enabled in
                var settings = environment.settings
                settings.useReasoningModel = enabled
                // 翻译由文字整理管线产出，关闭文字整理时必须联动关闭翻译。
                if !enabled, settings.translationEnabled {
                    settings.translationEnabled = false
                }
                environment.saveSettings(settings)
            }
        )
    }

    private var translationEnabledBinding: Binding<Bool> {
        Binding(
            get: { environment.settings.translationEnabled },
            set: { enabled in
                var settings = environment.settings
                settings.translationEnabled = enabled
                // 翻译由文字整理管线产出，开启翻译时必须联动启用文字整理。
                if enabled, !settings.useReasoningModel {
                    settings.useReasoningModel = true
                }
                if enabled && settings.translationTargetLanguage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    settings.translationTargetLanguage = "English"
                }
                environment.saveSettings(settings)
            }
        )
    }

    private var targetLanguages: [(key: LocalizedStringKey, value: String)] {
        [
            ("language.english", "English"),
            ("language.zhHans", "Simplified Chinese"),
            ("language.zhHant", "Traditional Chinese"),
            ("language.japanese", "Japanese"),
            ("language.korean", "Korean"),
            ("language.spanish", "Spanish"),
            ("language.french", "French"),
            ("language.german", "German"),
        ]
    }

    private func applyDefaults(for provider: String) {
        var settings = environment.settings
        let configuration = ReasoningProviderSupport.configuration(
            for: provider,
            currentModel: settings.reasoningModel,
            currentBaseURL: settings.reasoningBaseURL
        )
        guard configuration.model != settings.reasoningModel
                || configuration.baseURL != settings.reasoningBaseURL else { return }
        settings.reasoningModel = configuration.model
        settings.reasoningBaseURL = configuration.baseURL
        environment.saveSettings(settings)
    }
}

enum ReasoningProviderSupport {
    private static let defaults: [String: (model: String, baseURL: String)] = [
        "openai": ("gpt-4o-mini", "https://api.openai.com/v1"),
        "bailian": ("qwen-flash", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        "anthropic": ("claude-3-5-haiku-latest", "https://api.anthropic.com/v1"),
        "gemini": ("gemini-2.0-flash", "https://generativelanguage.googleapis.com/v1beta"),
        "groq": ("llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"),
    ]

    static func configuration(
        for provider: String,
        currentModel: String,
        currentBaseURL: String
    ) -> (model: String, baseURL: String) {
        guard let fallback = defaults[provider] else { return (currentModel, currentBaseURL) }

        let model = currentModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || Set(defaults.values.map { $0.model }).contains(currentModel)
            ? fallback.model
            : currentModel
        let baseURL = currentBaseURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || Set(defaults.values.map { $0.baseURL }).contains(currentBaseURL)
            ? fallback.baseURL
            : currentBaseURL
        return (model, baseURL)
    }

    static func displayName(for provider: String, language: UILanguage) -> String {
        switch provider {
        case "openai": "OpenAI"
        case "bailian": "Alibaba Bailian"
        case "anthropic": "Anthropic"
        case "gemini": "Gemini"
        case "groq": "Groq"
        case "custom": AppLocalization.string("provider.custom", language: language)
        default: provider.capitalized
        }
    }
}
