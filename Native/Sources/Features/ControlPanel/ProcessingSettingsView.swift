import SwiftUI

struct ProcessingSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var showingTest = false

    var body: some View {
        SettingsPage(title: "processing.title", subtitle: "processing.subtitle") {
            SettingsSection(title: "processing.cleanup") {
                SettingsRow(
                    icon: "wand.and.stars",
                    title: "processing.enableCleanup",
                    showsDivider: environment.settings.useReasoningModel
                ) {
                    Toggle("", isOn: settingBinding(environment, \.useReasoningModel))
                        .labelsHidden()
                }
                if environment.settings.useReasoningModel {
                    reasoningRows
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
                        .frame(width: 170)
                    }
                }
            }

            HStack {
                Spacer()
                Button("processing.try") {
                    showingTest = true
                }
                .disabled(!environment.settings.useReasoningModel && !environment.settings.translationEnabled)
            }
        }
        .sheet(isPresented: $showingTest) {
            ProcessingTestSheet()
                .environmentObject(environment)
        }
    }

    @ViewBuilder
    private var reasoningRows: some View {
        SettingsRow(icon: "server.rack", title: "processing.provider") {
            Picker("", selection: settingBinding(environment, \.reasoningProvider)) {
                Text("OpenAI").tag("openai")
                Text("Alibaba Bailian").tag("bailian")
                Text("Anthropic").tag("anthropic")
                Text("Gemini").tag("gemini")
                Text("Groq").tag("groq")
                Text("speech.local").tag("local")
                Text("provider.custom").tag("custom")
            }
            .labelsHidden()
            .frame(width: 170)
        }
        .task(id: environment.settings.reasoningProvider) {
            applyDefaults(for: environment.settings.reasoningProvider)
        }

        if environment.settings.reasoningProvider == "local" {
            SettingsRow(icon: "cube", title: "processing.model") {
                Picker("", selection: settingBinding(environment, \.reasoningModel)) {
                    ForEach(LocalReasoningModelCatalog.models) { model in
                        Text("\(model.name) · \(model.size)").tag(model.id)
                    }
                }
                .labelsHidden()
                .frame(width: 270)
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

private struct ProcessingTestSheet: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Environment(\.dismiss) private var dismiss

    @State private var input = ""
    @State private var result = ""
    @State private var isRunning = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("processing.try.title")
                    .font(.title2.weight(.semibold))
                Text("processing.try.subtitle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            TextEditor(text: $input)
                .font(.body)
                .frame(minHeight: 110)
                .padding(8)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay {
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(nsColor: .separatorColor), lineWidth: 0.5)
                }

            if !result.isEmpty {
                ScrollView {
                    Text(result)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .frame(minHeight: 100)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            HStack {
                Button("common.close") { dismiss() }
                Spacer()
                if isRunning { ProgressView().controlSize(.small) }
                Button("processing.try.run") {
                    isRunning = true
                    result = ""
                    Task {
                        do {
                            result = try await environment.testProcessing(input)
                        } catch {
                            result = error.localizedDescription
                        }
                        isRunning = false
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isRunning || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(width: 620, height: 440)
        .onAppear {
            if input.isEmpty {
                input = AppLocalization.string(
                    "promptStudio.defaultInput",
                    language: environment.settings.uiLanguage
                )
            }
        }
    }
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
