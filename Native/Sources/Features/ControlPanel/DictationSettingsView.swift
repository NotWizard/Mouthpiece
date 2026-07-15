import SwiftUI

struct DictationSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "speech.title", subtitle: "speech.subtitle") {
            SettingsSection(title: "speech.source") {
                TranscriptionModePicker()
                if environment.settings.useLocalTranscription {
                    LocalTranscriptionRows()
                } else {
                    CloudTranscriptionRows()
                }
            }

            SettingsSection(title: "speech.language") {
                SettingsRow(
                    icon: "character.book.closed",
                    title: "speech.spokenLanguage",
                    showsDivider: environment.settings.useLocalTranscription
                ) {
                    Picker("", selection: settingBinding(environment, \.preferredLanguage)) {
                        Text("language.auto").tag("auto")
                        Text("language.zhHans").tag("zh-CN")
                        Text("language.zhHant").tag("zh-TW")
                        Text("language.english").tag("en")
                        Text("language.japanese").tag("ja")
                    }
                    .labelsHidden()
                    .frame(width: 160, alignment: .trailing)
                }
                if environment.settings.useLocalTranscription {
                    SettingsRow(icon: "arrow.triangle.branch", title: "speech.fallback", showsDivider: false) {
                        Toggle("", isOn: settingBinding(environment, \.allowCloudFallback))
                            .labelsHidden()
                    }
                }
            }

            if !environment.settings.useLocalTranscription,
               environment.settings.cloudTranscriptionProvider == "custom" {
                SettingsSection(title: "speech.advanced") {
                    SettingsRow(icon: "link", title: "processing.baseURL", showsDivider: false) {
                        TextField(
                            "http://127.0.0.1:8080/v1",
                            text: settingBinding(environment, \.cloudTranscriptionBaseURL)
                        )
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 280)
                    }
                }
            }
        }
    }
}

struct TranscriptionModePicker: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsRow(icon: "cloud", title: "speech.location") {
            Picker("", selection: settingBinding(environment, \.useLocalTranscription)) {
                Text("speech.cloud").tag(false)
                Text("speech.local").tag(true)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 220)
            .onChange(of: environment.settings.useLocalTranscription) { _, usesLocal in
                if usesLocal {
                    environment.refreshLocalModelStatus()
                }
            }
        }
    }
}

struct CloudTranscriptionRows: View {
    @EnvironmentObject private var environment: AppEnvironment
    var onCredentialSaved: ((Bool) -> Void)?

    init(onCredentialSaved: ((Bool) -> Void)? = nil) {
        self.onCredentialSaved = onCredentialSaved
    }

    var body: some View {
        SettingsRow(icon: "server.rack", title: "speech.provider") {
            Picker("", selection: settingBinding(environment, \.cloudTranscriptionProvider)) {
                ForEach(CloudTranscriptionSupport.providers) { provider in
                    Text(provider.title).tag(provider.id)
                }
            }
            .labelsHidden()
            .frame(width: 180, alignment: .trailing)
            .onChange(of: environment.settings.cloudTranscriptionProvider) { _, provider in
                applyDefaultModel(for: provider)
            }
        }
        SettingsRow(icon: "cube", title: "speech.model") {
            TextField("speech.model.placeholder", text: settingBinding(environment, \.cloudTranscriptionModel))
                .textFieldStyle(.roundedBorder)
                .frame(width: 250)
        }
        realtimeRow
        CredentialEditor(account: CloudTranscriptionSupport.credential(for: environment.settings.cloudTranscriptionProvider)) {
            onCredentialSaved?($0)
        }
    }

    @ViewBuilder
    private var realtimeRow: some View {
        switch environment.settings.cloudTranscriptionProvider {
        case "bailian":
            SettingsRow(icon: "bolt", title: "speech.realtime") {
                Toggle("", isOn: settingBinding(environment, \.bailianRealtimeEnabled))
                    .labelsHidden()
            }
        case "deepgram":
            SettingsRow(icon: "bolt", title: "speech.realtime") {
                Toggle("", isOn: settingBinding(environment, \.deepgramStreamingEnabled))
                    .labelsHidden()
            }
        case "soniox":
            SettingsRow(icon: "bolt", title: "speech.realtime") {
                Toggle("", isOn: settingBinding(environment, \.sonioxRealtimeEnabled))
                    .labelsHidden()
            }
        case "assemblyai":
            SettingsRow(icon: "bolt", title: "speech.realtime") {
                Toggle("", isOn: settingBinding(environment, \.assemblyAIStreaming))
                    .labelsHidden()
            }
        default:
            EmptyView()
        }
    }

    private func applyDefaultModel(for provider: String) {
        var settings = environment.settings
        settings.cloudTranscriptionModel = CloudTranscriptionSupport.model(
            afterSelecting: provider,
            current: settings.cloudTranscriptionModel
        )
        if provider != "custom" {
            settings.cloudTranscriptionBaseURL = CloudTranscriptionSupport.defaultBaseURL(for: provider)
        }
        environment.saveSettings(settings)
    }
}

struct LocalTranscriptionRows: View {
    @EnvironmentObject private var environment: AppEnvironment
    var onAvailabilityChange: ((Bool) -> Void)?

    init(onAvailabilityChange: ((Bool) -> Void)? = nil) {
        self.onAvailabilityChange = onAvailabilityChange
    }

    var body: some View {
        SettingsRow(icon: "cpu", title: "speech.localEngine") {
            Picker("", selection: settingBinding(environment, \.localTranscriptionProvider)) {
                Text("Whisper").tag(LocalTranscriptionProvider.whisper)
                Text("Parakeet").tag(LocalTranscriptionProvider.parakeet)
                Text("Qwen ASR MLX").tag(LocalTranscriptionProvider.qwen)
            }
            .labelsHidden()
            .frame(width: 180, alignment: .trailing)
            .onChange(of: environment.settings.localTranscriptionProvider) { _, provider in
                ensureDefaultModel(for: provider)
                environment.refreshLocalModelStatus()
            }
        }
        SettingsRow(icon: "shippingbox", title: "speech.localModel") {
            Picker("", selection: localModelBinding) {
                ForEach(LocalModelCatalog.models(for: environment.settings.localTranscriptionProvider)) { model in
                    Text("\(model.displayName) · \(model.sizeLabel)").tag(model.id)
                }
            }
            .labelsHidden()
            .frame(width: 260, alignment: .trailing)
            .onChange(of: selectedModelID) { _, _ in environment.refreshLocalModelStatus() }
        }
        SettingsRow(icon: "internaldrive", title: "speech.modelStatus", showsDivider: false) {
            HStack(spacing: 8) {
                installationStatus
                Button {
                    environment.selectedLocalModelInstalled
                        ? environment.removeSelectedLocalModel()
                        : environment.installSelectedLocalModel()
                } label: {
                    Image(systemName: environment.selectedLocalModelInstalled ? "trash" : "arrow.down.circle")
                }
                .help(environment.selectedLocalModelInstalled ? "speech.removeModel" : "speech.installModel")
                .accessibilityLabel(environment.selectedLocalModelInstalled ? "speech.removeModel" : "speech.installModel")
                .disabled(isInstalling)
            }
        }
        .task(id: "\(environment.settings.localTranscriptionProvider.rawValue):\(selectedModelID)") {
            ensureDefaultModel(for: environment.settings.localTranscriptionProvider)
            environment.refreshLocalModelStatus()
            onAvailabilityChange?(environment.selectedLocalModelInstalled)
        }
        .onChange(of: environment.selectedLocalModelInstalled) { _, installed in
            onAvailabilityChange?(installed)
        }
    }

    @ViewBuilder
    private var installationStatus: some View {
        switch environment.modelInstallationState {
        case .installing(_, let detail):
            InlineStatus(verbatim: detail, kind: .progress)
        case .failed(_, let message):
            InlineStatus(verbatim: message, kind: .error)
                .frame(maxWidth: 220)
                .help(message)
        default:
            InlineStatus(
                environment.selectedLocalModelInstalled ? "speech.installed" : "speech.notInstalled",
                kind: environment.selectedLocalModelInstalled ? .success : .neutral
            )
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
        let models = LocalModelCatalog.models(for: provider)
        guard let first = models.first else { return }
        if !models.contains(where: { $0.id == selectedModelID }) {
            localModelBinding.wrappedValue = first.id
        }
    }
}

enum CloudTranscriptionSupport {
    struct Provider: Identifiable {
        let id: String
        let name: String

        var title: LocalizedStringKey {
            id == "custom" ? "provider.custom" : LocalizedStringKey(name)
        }
    }

    static let providers = [
        Provider(id: "bailian", name: "Alibaba Bailian"),
        Provider(id: "openai", name: "OpenAI"),
        Provider(id: "deepgram", name: "Deepgram"),
        Provider(id: "soniox", name: "Soniox"),
        Provider(id: "assemblyai", name: "AssemblyAI"),
        Provider(id: "groq", name: "Groq"),
        Provider(id: "mistral", name: "Mistral"),
        Provider(id: "custom", name: "Custom"),
    ]

    static func displayName(for provider: String, language: UILanguage) -> String {
        if provider == "custom" {
            return AppLocalization.string("provider.custom", language: language)
        }
        return providers.first(where: { $0.id == provider })?.name ?? provider.capitalized
    }

    static func credential(for provider: String) -> CredentialAccount {
        switch provider {
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

    static func defaultModel(for provider: String) -> String? {
        [
            "bailian": "qwen3-asr-flash",
            "openai": "gpt-4o-mini-transcribe",
            "deepgram": "nova-3",
            "soniox": "stt-rt-v4",
            "assemblyai": "universal-streaming-multilingual",
            "groq": "whisper-large-v3-turbo",
            "mistral": "voxtral-mini-latest",
        ][provider]
    }

    static func model(afterSelecting provider: String, current: String) -> String {
        guard let fallback = defaultModel(for: provider) else { return current }
        let knownDefaults = Set(providers.compactMap { defaultModel(for: $0.id) })
        let clean = current.trimmingCharacters(in: .whitespacesAndNewlines)
        return clean.isEmpty || knownDefaults.contains(clean) ? fallback : current
    }

    static func defaultBaseURL(for provider: String) -> String {
        switch provider {
        case "bailian": "https://dashscope.aliyuncs.com/compatible-mode/v1"
        case "openai": "https://api.openai.com/v1"
        case "groq": "https://api.groq.com/openai/v1"
        default: "https://api.openai.com/v1"
        }
    }
}
