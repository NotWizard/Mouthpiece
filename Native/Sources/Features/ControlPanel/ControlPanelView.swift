import AppKit
import SwiftUI

enum ControlPanelSection: String, CaseIterable, Identifiable {
    case general
    case speechRecognition
    case textProcessing
    case personalization
    case history
    case privacy

    var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .general: "sidebar.general"
        case .speechRecognition: "sidebar.speechRecognition"
        case .textProcessing: "sidebar.textProcessing"
        case .personalization: "sidebar.personalization"
        case .history: "sidebar.history"
        case .privacy: "sidebar.privacy"
        }
    }

    var icon: String {
        switch self {
        case .general: "gearshape"
        case .speechRecognition: "waveform"
        case .textProcessing: "text.badge.sparkles"
        case .personalization: "text.book.closed"
        case .history: "clock.arrow.circlepath"
        case .privacy: "hand.raised"
        }
    }
}

struct ControlPanelView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var selection: ControlPanelSection? = .general

    var body: some View {
        Group {
            if !environment.isReady {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !environment.settings.onboardingCompleted {
                OnboardingView()
            } else {
                NavigationSplitView {
                    List(ControlPanelSection.allCases, selection: $selection) { section in
                        Label(section.title, systemImage: section.icon)
                            .tag(section)
                    }
                    .listStyle(.sidebar)
                    .navigationTitle("Mouthpiece")
                    .navigationSplitViewColumnWidth(min: 176, ideal: 190, max: 210)
                } detail: {
                    detail(for: selection ?? .general)
                }
                .navigationSplitViewStyle(.balanced)
            }
        }
        .alert(
            String(localized: "common.error"),
            isPresented: Binding(
                get: { environment.startupError != nil },
                set: { presented in if !presented { environment.dismissStartupError() } }
            )
        ) {
            Button("common.ok") { environment.dismissStartupError() }
        } message: {
            Text(environment.startupError ?? "")
        }
    }

    @ViewBuilder
    private func detail(for section: ControlPanelSection) -> some View {
        switch section {
        case .general: GeneralSettingsView()
        case .speechRecognition: SpeechRecognitionSettingsView()
        case .textProcessing: TextProcessingSettingsView()
        case .personalization: PersonalizationSettingsView()
        case .history: HistoryView()
        case .privacy: PrivacySettingsView()
        }
    }
}

private struct SettingsPage<Content: View>: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.title2.weight(.semibold))
                    Text(subtitle).font(.callout).foregroundStyle(.secondary)
                }
                content
            }
            .padding(.horizontal, 30)
            .padding(.vertical, 26)
            .frame(maxWidth: 760, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct NativeSection<Content: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            VStack(spacing: 0) { content }
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }
    }
}

private struct SettingsRow<Content: View>: View {
    let icon: String
    let title: LocalizedStringKey
    var detail: LocalizedStringKey?
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: icon)
                .foregroundStyle(.secondary)
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.body)
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer(minLength: 16)
            content
        }
        .padding(.horizontal, 13)
        .frame(minHeight: detail == nil ? 42 : 52)
        .overlay(alignment: .bottom) {
            Divider().padding(.leading, 42)
        }
    }
}

extension View {
    @MainActor
    func settingBinding<Value>(
        _ environment: AppEnvironment,
        _ keyPath: WritableKeyPath<AppSettings, Value>
    ) -> Binding<Value> {
        Binding(
            get: { environment.settings[keyPath: keyPath] },
            set: { value in
                var settings = environment.settings
                settings[keyPath: keyPath] = value
                environment.saveSettings(settings)
            }
        )
    }
}

private struct GeneralSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "general.title", subtitle: "general.subtitle") {
            NativeSection(title: "general.interface") {
                SettingsRow(icon: "globe", title: "general.language") {
                    Picker("", selection: settingBinding(environment, \.uiLanguage)) {
                        Text("language.system").tag(UILanguage.system)
                        Text("language.zhHans").tag(UILanguage.simplifiedChinese)
                        Text("language.zhHant").tag(UILanguage.traditionalChinese)
                        Text("language.english").tag(UILanguage.english)
                    }.labelsHidden().frame(width: 150)
                }
                SettingsRow(icon: "circle.lefthalf.filled", title: "general.appearance") {
                    Picker("", selection: settingBinding(environment, \.theme)) {
                        Text("appearance.system").tag(AppTheme.system)
                        Text("appearance.light").tag(AppTheme.light)
                        Text("appearance.dark").tag(AppTheme.dark)
                    }.labelsHidden().frame(width: 130)
                }
            }

            NativeSection(title: "general.behavior") {
                SettingsRow(icon: "keyboard", title: "general.hotkey") {
                    TextField("RightCommand", text: settingBinding(environment, \.dictationKey))
                        .textFieldStyle(.roundedBorder).frame(width: 160)
                }
                SettingsRow(icon: "hand.tap", title: "general.hotkeyBehavior") {
                    Picker("", selection: settingBinding(environment, \.hotkeyBehavior)) {
                        Text("hotkey.automatic").tag(HotkeyBehavior.automatic)
                        Text("hotkey.toggle").tag(HotkeyBehavior.toggle)
                        Text("hotkey.pushToTalk").tag(HotkeyBehavior.pushToTalk)
                    }.labelsHidden().frame(width: 150)
                }
                SettingsRow(icon: "power", title: "general.launchAtLogin") {
                    Toggle("", isOn: settingBinding(environment, \.launchAtLogin)).labelsHidden()
                }
                SettingsRow(icon: "dock.rectangle", title: "general.showInDock") {
                    Toggle("", isOn: settingBinding(environment, \.showInDock)).labelsHidden()
                }
                SettingsRow(icon: "menubar.rectangle", title: "general.showInMenuBar") {
                    Toggle("", isOn: settingBinding(environment, \.showInMenuBar)).labelsHidden()
                }
                SettingsRow(icon: "escape", title: "general.escapeCancels") {
                    Toggle("", isOn: settingBinding(environment, \.escapeCancelsRecording)).labelsHidden()
                }
                SettingsRow(icon: "speaker.wave.2", title: "general.audioCues") {
                    Toggle("", isOn: settingBinding(environment, \.audioCuesEnabled)).labelsHidden()
                }
                if environment.settings.audioCuesEnabled {
                    SettingsRow(icon: "music.note", title: "general.soundPreset") {
                        HStack(spacing: 7) {
                            Picker("", selection: settingBinding(environment, \.soundPreset)) {
                                ForEach(AudioCueService.presets) { preset in
                                    Text(preset.name).tag(preset.id)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 155)
                            Button { environment.audioCues.playStart(preset: environment.settings.soundPreset) } label: {
                                Image(systemName: "play.fill")
                            }
                            .help("general.previewSound")
                        }
                    }
                }
            }

            NativeSection(title: "general.microphone") {
                SettingsRow(icon: "mic", title: "general.inputDevice") {
                    Picker("", selection: settingBinding(environment, \.selectedMicrophoneUID)) {
                        Text("general.systemDefault").tag("")
                        ForEach(environment.microphones) { device in
                            Text(device.name).tag(device.id)
                        }
                    }.labelsHidden().frame(width: 230)
                }
            }

            PermissionRows()
        }
    }
}

private struct PermissionRows: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        NativeSection(title: "permissions.title") {
            permissionRow(
                icon: "mic",
                title: "permissions.microphone",
                granted: environment.permissions.microphone,
                request: environment.requestMicrophonePermission,
                settings: environment.openMicrophoneSettings
            )
            permissionRow(
                icon: "accessibility",
                title: "permissions.accessibility",
                granted: environment.permissions.accessibility,
                request: environment.requestAccessibilityPermission,
                settings: environment.openAccessibilitySettings
            )
        }
    }

    private func permissionRow(
        icon: String,
        title: LocalizedStringKey,
        granted: Bool,
        request: @escaping () -> Void,
        settings: @escaping () -> Void
    ) -> some View {
        SettingsRow(icon: icon, title: title) {
            HStack(spacing: 8) {
                Label(granted ? "permissions.granted" : "permissions.required", systemImage: granted ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .font(.caption).foregroundStyle(granted ? .green : .orange)
                if !granted {
                    Button("permissions.allow", action: request)
                    Button(action: settings) { Image(systemName: "gearshape") }
                        .help("permissions.openSettings")
                }
            }
        }
    }
}

private struct SpeechRecognitionSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "speech.title", subtitle: "speech.subtitle") {
            NativeSection(title: "speech.source") {
                SettingsRow(icon: "network", title: "speech.useLocal") {
                    Toggle("", isOn: settingBinding(environment, \.useLocalTranscription)).labelsHidden()
                }
                if environment.settings.useLocalTranscription {
                    SettingsRow(icon: "cpu", title: "speech.localEngine") {
                        Picker("", selection: settingBinding(environment, \.localTranscriptionProvider)) {
                            Text("Whisper").tag(LocalTranscriptionProvider.whisper)
                            Text("Parakeet").tag(LocalTranscriptionProvider.parakeet)
                            Text("Qwen ASR MLX").tag(LocalTranscriptionProvider.qwen)
                        }.labelsHidden().frame(width: 170)
                            .onChange(of: environment.settings.localTranscriptionProvider) { _, provider in
                                ensureDefaultModel(for: provider)
                                environment.refreshLocalModelStatus()
                            }
                    }
                    SettingsRow(icon: "shippingbox", title: "speech.localModel") {
                        Picker("", selection: localModelBinding) {
                            ForEach(LocalModelCatalog.models(for: environment.settings.localTranscriptionProvider)) { model in
                                Text("\(model.displayName) (\(model.sizeLabel))").tag(model.id)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 240)
                        .onChange(of: selectedModelID) { _, _ in environment.refreshLocalModelStatus() }
                    }
                    SettingsRow(icon: "internaldrive", title: "speech.modelStatus") {
                        HStack(spacing: 8) {
                            switch environment.modelInstallationState {
                            case .installing:
                                ProgressView().controlSize(.small)
                                Text("speech.installing").font(.caption).foregroundStyle(.secondary)
                            case .failed(_, let message):
                                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                                Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                            default:
                                Label(
                                    environment.selectedLocalModelInstalled ? "speech.installed" : "speech.notInstalled",
                                    systemImage: environment.selectedLocalModelInstalled ? "checkmark.circle.fill" : "arrow.down.circle"
                                )
                                .font(.caption)
                                .foregroundStyle(environment.selectedLocalModelInstalled ? .green : .secondary)
                            }
                            Button {
                                environment.selectedLocalModelInstalled
                                    ? environment.removeSelectedLocalModel()
                                    : environment.installSelectedLocalModel()
                            } label: {
                                Image(systemName: environment.selectedLocalModelInstalled ? "trash" : "arrow.down.circle")
                            }
                            .help(environment.selectedLocalModelInstalled ? "speech.removeModel" : "speech.installModel")
                            .disabled(isInstalling)
                        }
                    }
                } else {
                    SettingsRow(icon: "cloud", title: "speech.provider") {
                        Picker("", selection: settingBinding(environment, \.cloudTranscriptionProvider)) {
                            Text("Alibaba Bailian").tag("bailian")
                            Text("OpenAI").tag("openai")
                            Text("Deepgram").tag("deepgram")
                            Text("Soniox").tag("soniox")
                            Text("AssemblyAI").tag("assemblyai")
                            Text("Groq").tag("groq")
                            Text("Mistral").tag("mistral")
                            Text("Custom").tag("custom")
                        }.labelsHidden().frame(width: 170)
                            .onChange(of: environment.settings.cloudTranscriptionProvider) { _, provider in
                                ensureCloudModel(for: provider)
                            }
                    }
                    SettingsRow(icon: "cube", title: "speech.model") {
                        TextField("Model", text: settingBinding(environment, \.cloudTranscriptionModel))
                            .frame(width: 230)
                    }
                    if environment.settings.cloudTranscriptionProvider == "custom" {
                        SettingsRow(icon: "link", title: "processing.baseURL") {
                            TextField(
                                "http://127.0.0.1:8080/v1",
                                text: settingBinding(environment, \.cloudTranscriptionBaseURL)
                            )
                            .frame(width: 270)
                        }
                    }
                    if environment.settings.cloudTranscriptionProvider == "bailian" {
                        SettingsRow(icon: "bolt", title: "speech.bailianRealtime") {
                            Toggle("", isOn: settingBinding(environment, \.bailianRealtimeEnabled)).labelsHidden()
                        }
                    } else if environment.settings.cloudTranscriptionProvider == "deepgram" {
                        SettingsRow(icon: "bolt", title: "speech.realtime") {
                            Toggle("", isOn: settingBinding(environment, \.deepgramStreamingEnabled)).labelsHidden()
                        }
                    } else if environment.settings.cloudTranscriptionProvider == "soniox" {
                        SettingsRow(icon: "bolt", title: "speech.realtime") {
                            Toggle("", isOn: settingBinding(environment, \.sonioxRealtimeEnabled)).labelsHidden()
                        }
                    } else if environment.settings.cloudTranscriptionProvider == "assemblyai" {
                        SettingsRow(icon: "bolt", title: "speech.realtime") {
                            Toggle("", isOn: settingBinding(environment, \.assemblyAIStreaming)).labelsHidden()
                        }
                    }
                    CredentialEditor(account: transcriptionCredential)
                }
            }

            NativeSection(title: "speech.language") {
                SettingsRow(icon: "character.book.closed", title: "speech.spokenLanguage") {
                    Picker("", selection: settingBinding(environment, \.preferredLanguage)) {
                        Text("language.auto").tag("auto")
                        Text("language.zhHans").tag("zh-CN")
                        Text("language.zhHant").tag("zh-TW")
                        Text("language.english").tag("en")
                        Text("日本語").tag("ja")
                    }.labelsHidden().frame(width: 150)
                }
                SettingsRow(icon: "arrow.triangle.branch", title: "speech.fallback") {
                    Toggle("", isOn: settingBinding(environment, \.allowCloudFallback)).labelsHidden()
                }
            }
        }
        .task(id: "\(environment.settings.localTranscriptionProvider.rawValue):\(selectedModelID)") {
            ensureDefaultModel(for: environment.settings.localTranscriptionProvider)
            environment.refreshLocalModelStatus()
        }
    }

    private var transcriptionCredential: CredentialAccount {
        switch environment.settings.cloudTranscriptionProvider {
        case "bailian": .bailian
        case "deepgram": .deepgram
        case "soniox": .soniox
        case "groq": .groq
        case "mistral": .mistral
        case "assemblyai": .assemblyAI
        case "custom": .customTranscription
        default: .openAI
        }
    }

    private var localModelBinding: Binding<String> {
        let keyPath: WritableKeyPath<AppSettings, String>
        switch environment.settings.localTranscriptionProvider {
        case .whisper: keyPath = \.whisperModel
        case .parakeet: keyPath = \.parakeetModel
        case .qwen: keyPath = \.qwenASRModel
        }
        return settingBinding(environment, keyPath)
    }

    private var selectedModelID: String { localModelBinding.wrappedValue }

    private var isInstalling: Bool {
        if case .installing = environment.modelInstallationState { return true }
        return false
    }

    private func ensureDefaultModel(for provider: LocalTranscriptionProvider) {
        guard let first = LocalModelCatalog.models(for: provider).first else { return }
        let available = LocalModelCatalog.models(for: provider).contains { $0.id == selectedModelID }
        if !available { localModelBinding.wrappedValue = first.id }
    }

    private func ensureCloudModel(for provider: String) {
        let defaults: [String: String] = [
            "bailian": "qwen3-asr-flash",
            "openai": "gpt-4o-mini-transcribe",
            "deepgram": "nova-3",
            "soniox": "stt-rt-v4",
            "assemblyai": "universal-streaming-multilingual",
            "groq": "whisper-large-v3-turbo",
            "mistral": "voxtral-mini-latest",
        ]
        guard let model = defaults[provider] else { return }
        var settings = environment.settings
        settings.cloudTranscriptionModel = model
        environment.saveSettings(settings)
    }
}

struct CredentialEditor: View {
    @EnvironmentObject private var environment: AppEnvironment
    let account: CredentialAccount
    @State private var value = ""
    @State private var status = ""

    var body: some View {
        SettingsRow(icon: "key", title: "speech.apiKey") {
            HStack(spacing: 7) {
                SecureField("API Key", text: $value).frame(width: 230)
                Button("common.save") {
                    Task {
                        do {
                            try await environment.saveCredential(value, account: account)
                            status = String(localized: "common.saved")
                        } catch { status = error.localizedDescription }
                    }
                }
                if !status.isEmpty { Text(status).font(.caption).foregroundStyle(.secondary) }
            }
        }
        .task(id: account) { value = await environment.credential(account) }
    }
}

private struct TextProcessingSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "processing.title", subtitle: "processing.subtitle") {
            NativeSection(title: "processing.cleanup") {
                SettingsRow(icon: "wand.and.stars", title: "processing.enableCleanup") {
                    Toggle("", isOn: settingBinding(environment, \.useReasoningModel)).labelsHidden()
                }
                SettingsRow(icon: "server.rack", title: "processing.provider") {
                    Picker("", selection: settingBinding(environment, \.reasoningProvider)) {
                        Text("OpenAI").tag("openai")
                        Text("Alibaba Bailian").tag("bailian")
                        Text("Anthropic").tag("anthropic")
                        Text("Gemini").tag("gemini")
                        Text("Groq").tag("groq")
                        Text("Local").tag("local")
                        Text("Custom").tag("custom")
                    }.labelsHidden().frame(width: 160)
                        .onChange(of: environment.settings.reasoningProvider) { _, provider in
                            ensureReasoningDefaults(for: provider)
                        }
                }
                if environment.settings.reasoningProvider == "local" {
                    SettingsRow(icon: "cube", title: "processing.model") {
                        Picker("", selection: settingBinding(environment, \.reasoningModel)) {
                            ForEach(LocalReasoningModelCatalog.models) { model in
                                Text("\(model.name) · \(model.size)").tag(model.id)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 250)
                        .onChange(of: environment.settings.reasoningModel) { _, _ in
                            environment.refreshReasoningModelStatus()
                        }
                    }
                    SettingsRow(icon: "arrow.down.circle", title: "speech.modelStatus") {
                        HStack(spacing: 8) {
                            Text(environment.selectedReasoningModelInstalled ? "speech.installed" : "speech.notInstalled")
                                .font(.caption)
                                .foregroundStyle(environment.selectedReasoningModelInstalled ? .green : .secondary)
                            if environment.selectedReasoningModelInstalled {
                                Button {
                                    environment.removeSelectedReasoningModel()
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .help("speech.removeModel")
                            } else {
                                Button { environment.installSelectedReasoningModel() } label: {
                                    Image(systemName: "arrow.down.circle")
                                }
                                .help("speech.installModel")
                            }
                        }
                    }
                    reasoningInstallationStatus
                } else {
                    SettingsRow(icon: "cube", title: "processing.model") {
                        TextField("Model", text: settingBinding(environment, \.reasoningModel)).frame(width: 230)
                    }
                }
                if environment.settings.reasoningProvider == "custom" {
                    SettingsRow(icon: "link", title: "processing.baseURL") {
                        TextField("http://127.0.0.1:8080/v1", text: settingBinding(environment, \.reasoningBaseURL))
                            .frame(width: 270)
                    }
                }
                if environment.settings.reasoningProvider != "local" {
                    CredentialEditor(account: reasoningCredential)
                }
                if environment.settings.reasoningProvider == "bailian" {
                    SettingsRow(icon: "brain", title: "processing.enableThinking") {
                        Toggle("", isOn: settingBinding(environment, \.bailianReasoningEnableThinking)).labelsHidden()
                    }
                } else if environment.settings.reasoningProvider == "custom" {
                    SettingsRow(icon: "brain", title: "processing.enableThinking") {
                        Toggle("", isOn: settingBinding(environment, \.customReasoningEnableThinking)).labelsHidden()
                    }
                }
            }
            NativeSection(title: "processing.translation") {
                SettingsRow(icon: "translate", title: "processing.enableTranslation") {
                    Toggle("", isOn: settingBinding(environment, \.translationEnabled)).labelsHidden()
                }
                if environment.settings.translationEnabled {
                    SettingsRow(icon: "keyboard", title: "processing.translationHotkey") {
                        TextField("Command+K", text: settingBinding(environment, \.translationDictationKey))
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 160)
                    }
                    SettingsRow(icon: "globe", title: "processing.targetLanguage") {
                        TextField("English", text: settingBinding(environment, \.translationTargetLanguage))
                            .frame(width: 180)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var reasoningInstallationStatus: some View {
        switch environment.reasoningModelInstallationState {
        case .idle, .installed:
            EmptyView()
        case .installing(_, let detail):
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(detail).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
        case .failed(_, let message):
            Text(message)
                .font(.caption)
                .foregroundStyle(.red)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
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

    private func ensureReasoningDefaults(for provider: String) {
        let defaults: [String: (model: String, baseURL: String)] = [
            "openai": ("gpt-4o-mini", "https://api.openai.com/v1"),
            "bailian": ("qwen-flash", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
            "anthropic": ("claude-3-5-haiku-latest", "https://api.anthropic.com/v1"),
            "gemini": ("gemini-2.0-flash", "https://generativelanguage.googleapis.com/v1beta"),
            "groq": ("llama-3.3-70b-versatile", "https://api.groq.com/openai/v1"),
            "local": ("qwen3-1.7b-q8_0", ""),
        ]
        guard let value = defaults[provider] else { return }
        var settings = environment.settings
        settings.reasoningModel = value.model
        settings.reasoningBaseURL = value.baseURL
        environment.saveSettings(settings)
    }
}

private struct PersonalizationSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var newWord = ""
    @State private var newAvoidedTerm = ""
    @State private var replacementSource = ""
    @State private var replacementTarget = ""
    @State private var promptTab = PromptStudioTab.current
    @State private var promptDraft = ""
    @State private var testInput = ""
    @State private var testResult = ""
    @State private var isTestingPrompt = false

    var body: some View {
        SettingsPage(title: "personalization.title", subtitle: "personalization.subtitle") {
            NativeSection(title: "personalization.dictionary") {
                HStack {
                    TextField("personalization.newTerm", text: $newWord)
                    Button {
                        let clean = newWord.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !clean.isEmpty else { return }
                        environment.saveDictionary(environment.dictionaryWords + [clean])
                        newWord = ""
                    } label: { Image(systemName: "plus") }
                    .help("personalization.addTerm")
                }.padding(12)
                ForEach(environment.dictionaryWords, id: \.self) { word in
                    SettingsRow(icon: "textformat", title: LocalizedStringKey(word)) {
                        Button {
                            environment.saveDictionary(environment.dictionaryWords.filter { $0 != word })
                        } label: { Image(systemName: "trash") }
                        .buttonStyle(.plain).help("common.delete")
                    }
                }
            }
            NativeSection(title: "personalization.avoidedTerms") {
                HStack {
                    TextField("personalization.newAvoidedTerm", text: $newAvoidedTerm)
                    Button {
                        let clean = newAvoidedTerm.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !clean.isEmpty else { return }
                        updateTerminology { $0.avoidedTerms.append(clean) }
                        newAvoidedTerm = ""
                    } label: { Image(systemName: "plus") }
                    .help("personalization.addAvoidedTerm")
                }.padding(12)
                ForEach(environment.settings.terminologyProfile.avoidedTerms, id: \.self) { term in
                    SettingsRow(icon: "nosign", title: LocalizedStringKey(term)) {
                        Button {
                            updateTerminology { $0.avoidedTerms.removeAll { $0 == term } }
                        } label: { Image(systemName: "trash") }
                        .buttonStyle(.plain).help("common.delete")
                    }
                }
            }
            NativeSection(title: "personalization.replacements") {
                HStack(spacing: 8) {
                    TextField("personalization.replacementSource", text: $replacementSource)
                    Image(systemName: "arrow.right").foregroundStyle(.secondary)
                    TextField("personalization.replacementTarget", text: $replacementTarget)
                    Button {
                        let source = replacementSource.trimmingCharacters(in: .whitespacesAndNewlines)
                        let target = replacementTarget.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !source.isEmpty, !target.isEmpty else { return }
                        updateTerminology { $0.replacementRules[source] = target }
                        replacementSource = ""
                        replacementTarget = ""
                    } label: { Image(systemName: "plus") }
                    .help("personalization.addReplacement")
                }.padding(12)
                ForEach(environment.settings.terminologyProfile.replacementRules.keys.sorted(), id: \.self) { source in
                    SettingsRow(icon: "arrow.left.arrow.right", title: LocalizedStringKey(source)) {
                        HStack(spacing: 8) {
                            Text(environment.settings.terminologyProfile.replacementRules[source] ?? "")
                                .foregroundStyle(.secondary)
                            Button {
                                updateTerminology { $0.replacementRules.removeValue(forKey: source) }
                            } label: { Image(systemName: "trash") }
                            .buttonStyle(.plain).help("common.delete")
                        }
                    }
                }
            }
            NativeSection(title: "personalization.prompt") {
                Picker("", selection: $promptTab) {
                    Label("promptStudio.current", systemImage: "eye").tag(PromptStudioTab.current)
                    Label("promptStudio.edit", systemImage: "pencil").tag(PromptStudioTab.edit)
                    Label("promptStudio.test", systemImage: "testtube.2").tag(PromptStudioTab.test)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(12)

                switch promptTab {
                case .current:
                    ScrollView {
                        Text(ReasoningService.systemPrompt(settings: environment.settings))
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                    }
                    .frame(minHeight: 180, maxHeight: 300)
                case .edit:
                    TextEditor(text: $promptDraft)
                        .font(.system(.caption, design: .monospaced))
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 240)
                        .padding(10)
                    HStack {
                        Button {
                            var settings = environment.settings
                            settings.customPrompt = promptDraft
                            environment.saveSettings(settings)
                        } label: {
                            Label("common.save", systemImage: "square.and.arrow.down")
                        }
                        Button {
                            promptDraft = ReasoningService.defaultCleanupPrompt
                            var settings = environment.settings
                            settings.customPrompt = ""
                            environment.saveSettings(settings)
                        } label: {
                            Label("promptStudio.reset", systemImage: "arrow.counterclockwise")
                        }
                    }
                    .padding(12)
                case .test:
                    VStack(alignment: .leading, spacing: 10) {
                        TextEditor(text: $testInput)
                            .font(.body)
                            .frame(minHeight: 90)
                            .overlay(RoundedRectangle(cornerRadius: 5).stroke(.separator))
                        HStack {
                            Button {
                                isTestingPrompt = true
                                testResult = ""
                                Task {
                                    do {
                                        testResult = try await environment.testPrompt(promptDraft, input: testInput)
                                    } catch {
                                        testResult = error.localizedDescription
                                    }
                                    isTestingPrompt = false
                                }
                            } label: {
                                Label("promptStudio.runTest", systemImage: "play.fill")
                            }
                            .disabled(isTestingPrompt || testInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            if isTestingPrompt { ProgressView().controlSize(.small) }
                        }
                        if !testResult.isEmpty {
                            Text(testResult)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(Color(nsColor: .textBackgroundColor))
                                .clipShape(RoundedRectangle(cornerRadius: 5))
                        }
                    }
                    .padding(12)
                }
            }
        }
        .onAppear {
            promptDraft = environment.settings.customPrompt.isEmpty
                ? ReasoningService.defaultCleanupPrompt
                : environment.settings.customPrompt
            if testInput.isEmpty { testInput = String(localized: "promptStudio.defaultInput") }
        }
    }

    private func updateTerminology(_ mutation: (inout TerminologyProfile) -> Void) {
        var settings = environment.settings
        mutation(&settings.terminologyProfile)
        settings.terminologyProfile.normalize()
        environment.saveSettings(settings)
    }
}

private enum PromptStudioTab: String, CaseIterable {
    case current
    case edit
    case test
}

private struct HistoryView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "history.title", subtitle: "history.subtitle") {
            HStack {
                Text(String(format: String(localized: "history.count"), environment.transcriptions.count))
                    .font(.callout).foregroundStyle(.secondary)
                Spacer()
                Button("history.clear", role: .destructive) { environment.clearHistory() }
                    .disabled(environment.transcriptions.isEmpty)
            }
            LazyVStack(spacing: 1) {
                ForEach(environment.transcriptions) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: "waveform").foregroundStyle(.secondary).padding(.top, 2)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.text).textSelection(.enabled)
                            if let rawText = item.rawText, !rawText.isEmpty, rawText != item.text {
                                DisclosureGroup("history.rawTranscript") {
                                    Text(rawText)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .textSelection(.enabled)
                                        .padding(.top, 3)
                                }
                                .font(.caption)
                            }
                            Text(item.timestamp.formatted(date: .abbreviated, time: .shortened))
                                .font(.caption).foregroundStyle(.tertiary)
                        }
                        Spacer()
                        Button {
                            NSPasteboard.general.clearContents()
                            NSPasteboard.general.setString(item.text, forType: .string)
                        } label: { Image(systemName: "doc.on.doc") }
                        .buttonStyle(.plain).help("common.copy")
                        Button { environment.deleteTranscription(item.id) } label: {
                            Image(systemName: "trash")
                        }.buttonStyle(.plain).help("common.delete")
                    }
                    .padding(12)
                    .background(Color(nsColor: .controlBackgroundColor))
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 7))
        }
        .onAppear { environment.refreshHistory() }
    }
}

private struct PrivacySettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "privacy.title", subtitle: "privacy.subtitle") {
            NativeSection(title: "privacy.sensitiveApps") {
                SettingsRow(icon: "hand.raised", title: "privacy.protection") {
                    Toggle("", isOn: settingBinding(environment, \.sensitiveAppProtectionEnabled)).labelsHidden()
                }
                SettingsRow(icon: "text.badge.xmark", title: "privacy.blockInsertion") {
                    Toggle("", isOn: settingBinding(environment, \.sensitiveAppBlockInsertion)).labelsHidden()
                }
                SettingsRow(icon: "cloud.slash", title: "privacy.allowCloudReasoning") {
                    Toggle("", isOn: settingBinding(environment, \.allowSensitiveAppCloudReasoning)).labelsHidden()
                }
            }
            NativeSection(title: "privacy.diagnostics") {
                SettingsRow(icon: "arrow.triangle.2.circlepath", title: "privacy.updates") {
                    Button("privacy.checkForUpdates") { environment.checkForUpdates() }
                        .disabled(!environment.updates.isConfigured)
                }
                SettingsRow(icon: "ladybug", title: "privacy.debugLogging", detail: "privacy.debugRetention") {
                    Toggle("", isOn: settingBinding(environment, \.debugLoggingEnabled)).labelsHidden()
                }
                SettingsRow(icon: "folder", title: "privacy.openLogs") {
                    Button("privacy.open") { NSWorkspace.shared.open(AppPaths.logsDirectory) }
                }
            }
            NativeSection(title: "privacy.about") {
                SettingsRow(icon: "info.circle", title: "privacy.version") {
                    Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2.0.0")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }
}
