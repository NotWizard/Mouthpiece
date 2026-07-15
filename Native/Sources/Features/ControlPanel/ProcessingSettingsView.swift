import AppKit
import SwiftUI

struct ProcessingSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.colorScheme) private var colorScheme
    @State private var showingPromptStudio = false

    var body: some View {
        SettingsPage(title: "processing.title", subtitle: "processing.subtitle") {
            SettingsSection(title: "processing.cleanup") {
                SettingsRow(
                    icon: "wand.and.stars",
                    title: "processing.enableCleanup",
                    showsDivider: false
                ) {
                    Toggle("", isOn: settingBinding(environment, \.useReasoningModel))
                        .labelsHidden()
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
                    showsDivider: environment.settings.translationEnabled
                ) {
                    Toggle("", isOn: translationEnabledBinding)
                        .labelsHidden()
                }
                if environment.settings.translationEnabled {
                    SettingsRow(
                        icon: "keyboard",
                        title: "processing.translationHotkey",
                        detail: hasTranslationHotkeyConflict ? "processing.hotkeyConflict" : nil
                    ) {
                        HotkeyRecorder(value: settingBinding(environment, \.translationDictationKey))
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
        VStack(alignment: .leading, spacing: 8) {
            Text("processing.provider")
                .font(.subheadline.weight(.semibold))
                .padding(.leading, 2)
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 150), spacing: 8)],
                spacing: 8
            ) {
                ForEach(reasoningProviders) { provider in
                    Button {
                        var settings = environment.settings
                        settings.reasoningProvider = provider.id
                        environment.saveSettings(settings)
                    } label: {
                        HStack(spacing: 9) {
                            providerIcon(provider)
                            Text(provider.title)
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            if environment.settings.reasoningProvider == provider.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.tint)
                            }
                        }
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(
                            environment.settings.reasoningProvider == provider.id
                                ? Color.accentColor.opacity(0.12)
                                : Color(
                                    nsColor: colorScheme == .dark
                                        ? .underPageBackgroundColor
                                        : .controlBackgroundColor
                                )
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(
                                    environment.settings.reasoningProvider == provider.id
                                        ? Color.accentColor.opacity(0.75)
                                        : Color(nsColor: .separatorColor).opacity(0.45),
                                    lineWidth: environment.settings.reasoningProvider == provider.id ? 1.5 : 0.5
                                )
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(
                        environment.settings.reasoningProvider == provider.id ? .isSelected : []
                    )
                }
            }
        }
        .task(id: environment.settings.reasoningProvider) {
            applyDefaults(for: environment.settings.reasoningProvider)
        }
    }

    @ViewBuilder
    private func providerIcon(_ provider: ReasoningProviderOption) -> some View {
        if let assetName = provider.assetName,
           let url = Bundle.main.url(forResource: assetName, withExtension: "svg"),
           let image = NSImage(contentsOf: url) {
            let _ = image.isTemplate = provider.rendersAsTemplate
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
        } else {
            Image(systemName: provider.fallbackIcon)
                .frame(width: 18)
        }
    }

    @ViewBuilder
    private var reasoningRows: some View {
        if environment.settings.reasoningProvider == "local" {
            SettingsRow(icon: "cube", title: "processing.model") {
                Picker("", selection: settingBinding(environment, \.reasoningModel)) {
                    ForEach(LocalReasoningModelCatalog.models) { model in
                        Text("\(model.name) · \(model.size)").tag(model.id)
                    }
                }
                .labelsHidden()
                .frame(width: 270, alignment: .trailing)
                .onChange(of: environment.settings.reasoningModel) { _, _ in
                    environment.refreshReasoningModelStatus()
                }
            }
            SettingsRow(icon: "internaldrive", title: "speech.modelStatus", showsDivider: false) {
                HStack(spacing: 8) {
                    reasoningInstallationStatus
                    Button {
                        environment.selectedReasoningModelInstalled
                            ? environment.removeSelectedReasoningModel()
                            : environment.installSelectedReasoningModel()
                    } label: {
                        Image(systemName: environment.selectedReasoningModelInstalled ? "trash" : "arrow.down.circle")
                    }
                    .help(environment.selectedReasoningModelInstalled ? "speech.removeModel" : "speech.installModel")
                    .accessibilityLabel(environment.selectedReasoningModelInstalled ? "speech.removeModel" : "speech.installModel")
                    .disabled(isInstallingReasoningModel)
                }
            }
        } else {
            SettingsRow(icon: "cube", title: "processing.model") {
                TextField("speech.model.placeholder", text: settingBinding(environment, \.reasoningModel))
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 250)
            }
            if environment.settings.reasoningProvider == "custom" {
                SettingsRow(icon: "link", title: "processing.baseURL") {
                    TextField(
                        "http://127.0.0.1:8080/v1",
                        text: settingBinding(environment, \.reasoningBaseURL)
                    )
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 280)
                }
            }
            CredentialEditor(
                account: reasoningCredential,
                showsDivider: environment.settings.reasoningProvider == "bailian"
                    || environment.settings.reasoningProvider == "custom"
            )
            if environment.settings.reasoningProvider == "bailian" {
                SettingsRow(icon: "brain", title: "processing.enableThinking", showsDivider: false) {
                    Toggle("", isOn: settingBinding(environment, \.bailianReasoningEnableThinking))
                        .labelsHidden()
                }
            } else if environment.settings.reasoningProvider == "custom" {
                SettingsRow(icon: "brain", title: "processing.enableThinking", showsDivider: false) {
                    Toggle("", isOn: settingBinding(environment, \.customReasoningEnableThinking))
                        .labelsHidden()
                }
            }
        }
    }

    @ViewBuilder
    private var reasoningInstallationStatus: some View {
        switch environment.reasoningModelInstallationState {
        case .installing(_, let detail):
            InlineStatus(verbatim: detail, kind: .progress)
        case .failed(_, let message):
            InlineStatus(verbatim: message, kind: .error)
                .frame(maxWidth: 220)
                .help(message)
        default:
            InlineStatus(
                environment.selectedReasoningModelInstalled ? "speech.installed" : "speech.notInstalled",
                kind: environment.selectedReasoningModelInstalled ? .success : .neutral
            )
        }
    }

    private var isInstallingReasoningModel: Bool {
        if case .installing = environment.reasoningModelInstallationState { return true }
        return false
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

    private var reasoningProviders: [ReasoningProviderOption] {
        [
            .init(id: "openai", title: "provider.openai", assetName: "provider-openai", fallbackIcon: "sparkles", rendersAsTemplate: true),
            .init(id: "bailian", title: "provider.bailian", assetName: "provider-alibaba-cloud", fallbackIcon: "cloud", rendersAsTemplate: true),
            .init(id: "anthropic", title: "provider.anthropic", assetName: "provider-anthropic", fallbackIcon: "text.bubble", rendersAsTemplate: true),
            .init(id: "gemini", title: "provider.gemini", assetName: "provider-gemini", fallbackIcon: "diamond", rendersAsTemplate: false),
            .init(id: "groq", title: "provider.groq", assetName: "provider-groq", fallbackIcon: "bolt", rendersAsTemplate: false),
            .init(id: "local", title: "provider.local", assetName: nil, fallbackIcon: "desktopcomputer", rendersAsTemplate: true),
            .init(id: "custom", title: "provider.custom", assetName: nil, fallbackIcon: "slider.horizontal.3", rendersAsTemplate: true),
        ]
    }

    private var hasTranslationHotkeyConflict: Bool {
        HotkeyCapture.conflicts(
            environment.settings.dictationKey,
            environment.settings.translationDictationKey
        )
    }

    private var translationEnabledBinding: Binding<Bool> {
        Binding(
            get: { environment.settings.translationEnabled },
            set: { enabled in
                var settings = environment.settings
                settings.translationEnabled = enabled
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

private struct ReasoningProviderOption: Identifiable {
    let id: String
    let title: LocalizedStringKey
    let assetName: String?
    let fallbackIcon: String
    let rendersAsTemplate: Bool
}

enum ReasoningProviderSupport {
    private static let defaults: [String: (model: String, baseURL: String)] = [
        "openai": ("gpt-4o-mini", "https://api.openai.com/v1"),
        "bailian": ("qwen-flash", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        "anthropic": ("claude-3-5-haiku-latest", "https://api.anthropic.com/v1"),
        "gemini": ("gemini-2.0-flash", "https://generativelanguage.googleapis.com/v1beta"),
        "groq": ("llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"),
        "local": ("qwen3-1.7b-q8_0", ""),
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
        case "local": AppLocalization.string("speech.local", language: language)
        case "custom": AppLocalization.string("provider.custom", language: language)
        default: provider.capitalized
        }
    }
}
