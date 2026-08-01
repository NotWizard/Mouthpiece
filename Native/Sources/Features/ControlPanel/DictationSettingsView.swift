import SwiftUI

struct DictationSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "speech.title", subtitle: "speech.subtitle") {
            SettingsSection(title: "speech.source") {
                TranscriptionModePicker(showsDivider: environment.settings.useLocalTranscription)
                if environment.settings.useLocalTranscription {
                    LocalTranscriptionRows()
                }
            }

            if !environment.settings.useLocalTranscription {
                CloudProviderSelector()
                SettingsSection(title: "speech.configuration") {
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
                            .toggleStyle(.switch)
                            .controlSize(.small)
                    }
                }
            }
        }
    }
}

struct TranscriptionModePicker: View {
    @EnvironmentObject private var environment: AppEnvironment
    var showsDivider = true

    var body: some View {
        SettingsRow(icon: "cloud", title: "speech.location", showsDivider: showsDivider) {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                Picker("", selection: settingBinding(environment, \.useLocalTranscription)) {
                    Text("speech.cloud").tag(false)
                    Text("speech.local").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize(horizontal: true, vertical: false)
            }
            .frame(width: 320)
            .onChange(of: environment.settings.useLocalTranscription) { _, usesLocal in
                if usesLocal {
                    environment.refreshLocalModelStatus()
                }
            }
        }
    }
}

struct CloudProviderSelector: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        ProviderSelectionGrid(
            title: "speech.provider",
            providers: CloudTranscriptionSupport.providers,
            selectedID: environment.settings.cloudTranscriptionProvider,
            onSelect: select
        )
    }

    private func select(_ provider: String) {
        var settings = environment.settings
        if settings.cloudTranscriptionProvider == "bailian",
           BailianASRModel(rawValue: settings.cloudTranscriptionModel) != nil {
            settings.bailianTranscriptionModel = settings.cloudTranscriptionModel
        }
        settings.cloudTranscriptionProvider = provider
        settings.cloudTranscriptionModel = CloudTranscriptionSupport.model(
            afterSelecting: provider,
            current: settings.cloudTranscriptionModel,
            rememberedBailianModel: settings.bailianTranscriptionModel
        )
        if provider != "custom" {
            settings.cloudTranscriptionBaseURL = CloudTranscriptionSupport.defaultBaseURL(for: provider)
        }
        environment.saveSettings(settings)
    }
}

struct CloudTranscriptionRows: View {
    @EnvironmentObject private var environment: AppEnvironment
    var onCredentialSaved: ((Bool) -> Void)?

    init(onCredentialSaved: ((Bool) -> Void)? = nil) {
        self.onCredentialSaved = onCredentialSaved
    }

    var body: some View {
        CredentialEditor(
            account: CloudTranscriptionSupport.credential(for: environment.settings.cloudTranscriptionProvider),
            showsDivider: true
        ) {
            onCredentialSaved?($0)
        }
        .id(CloudTranscriptionSupport.credential(for: environment.settings.cloudTranscriptionProvider))
        SettingsRow(
            icon: "cube",
            title: "speech.model",
            showsDivider: modelShowsDivider
        ) {
            if environment.settings.cloudTranscriptionProvider == "bailian" {
                HStack(spacing: 8) {
                    Picker("", selection: bailianModelBinding) {
                        ForEach(BailianASRModel.allCases, id: \.rawValue) { model in
                            Text(LocalizedStringKey(model.titleKey)).tag(model.rawValue)
                        }
                    }
                    .labelsHidden()
                    .frame(width: SettingsControlMetrics.configurationFieldWidth - 32)
                    ModelHelpIcon(LocalizedStringKey(selectedBailianModel.helpKey))
                }
                .frame(width: SettingsControlMetrics.configurationFieldWidth, alignment: .trailing)
            } else if environment.settings.cloudTranscriptionProvider == "volcengine" {
                HStack(spacing: 8) {
                    Text("speech.volcengineModel")
                        .foregroundStyle(.secondary)
                    ModelHelpIcon("speech.volcengineOnly")
                }
                .frame(width: SettingsControlMetrics.configurationFieldWidth, alignment: .trailing)
            } else {
                DeferredSettingTextField(
                    "speech.model.placeholder",
                    value: environment.settings.cloudTranscriptionModel,
                    keyPath: \.cloudTranscriptionModel,
                    width: SettingsControlMetrics.configurationFieldWidth
                )
            }
        }
        if environment.settings.cloudTranscriptionProvider == "custom" {
            SettingsRow(icon: "link", title: "processing.baseURL", showsDivider: false) {
                DeferredSettingTextField(
                    "http://127.0.0.1:8080/v1",
                    value: environment.settings.cloudTranscriptionBaseURL,
                    keyPath: \.cloudTranscriptionBaseURL,
                    width: 280
                )
            }
        } else {
            realtimeRow
        }
    }

    private var supportsRealtime: Bool {
        ["deepgram", "soniox", "assemblyai"]
            .contains(environment.settings.cloudTranscriptionProvider)
    }

    private var modelShowsDivider: Bool {
        supportsRealtime || environment.settings.cloudTranscriptionProvider == "custom"
    }

    private var selectedBailianModel: BailianASRModel {
        BailianASRModel(rawValue: environment.settings.cloudTranscriptionModel) ?? .defaultModel
    }

    private var bailianModelBinding: Binding<String> {
        Binding(
            get: { selectedBailianModel.rawValue },
            set: { value in
                guard BailianASRModel(rawValue: value) != nil else { return }
                var settings = environment.settings
                settings.cloudTranscriptionModel = value
                settings.bailianTranscriptionModel = value
                environment.saveSettings(settings)
            }
        )
    }

    @ViewBuilder
    private var realtimeRow: some View {
        switch environment.settings.cloudTranscriptionProvider {
        case "deepgram":
            SettingsRow(icon: "bolt", title: "speech.realtime", showsDivider: false) {
                Toggle("", isOn: settingBinding(environment, \.deepgramStreamingEnabled))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
        case "soniox":
            SettingsRow(icon: "bolt", title: "speech.realtime", showsDivider: false) {
                Toggle("", isOn: settingBinding(environment, \.sonioxRealtimeEnabled))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
        case "assemblyai":
            SettingsRow(icon: "bolt", title: "speech.realtime", showsDivider: false) {
                Toggle("", isOn: settingBinding(environment, \.assemblyAIStreaming))
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.small)
            }
        default:
            EmptyView()
        }
    }
}

private struct ModelHelpIcon: View {
    let message: LocalizedStringKey
    @State private var showsHelp = false

    init(_ message: LocalizedStringKey) {
        self.message = message
    }

    var body: some View {
        Image(systemName: "info.circle")
            .foregroundStyle(.tertiary)
            .frame(width: 24, height: 24)
            .contentShape(Rectangle())
            .onHover { showsHelp = $0 }
            .popover(isPresented: $showsHelp, arrowEdge: .top) {
                Text(message)
                    .font(.caption)
                    .frame(maxWidth: 260, alignment: .leading)
                    .padding(10)
            }
            .help(message)
            .accessibilityLabel(message)
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
    static let providers = [
        ProviderChoice(id: "bailian", title: "provider.bailian", assetName: "provider-alibaba-cloud", fallbackIcon: "cloud", rendersAsTemplate: false),
        ProviderChoice(id: "volcengine", title: "provider.volcengine", assetName: "provider-volcengine", fallbackIcon: "waveform", rendersAsTemplate: false),
        ProviderChoice(id: "openai", title: "provider.openai", assetName: "provider-openai", fallbackIcon: "sparkles"),
        ProviderChoice(id: "deepgram", title: "provider.deepgram", assetName: "provider-deepgram", fallbackIcon: "waveform", rendersAsTemplate: false),
        ProviderChoice(id: "soniox", title: "provider.soniox", assetName: "provider-soniox", assetExtension: "png", fallbackIcon: "waveform", rendersAsTemplate: false),
        ProviderChoice(id: "assemblyai", title: "provider.assemblyai", assetName: "provider-assemblyai", assetExtension: "png", fallbackIcon: "waveform", rendersAsTemplate: false),
        ProviderChoice(id: "groq", title: "provider.groq", assetName: "provider-groq", fallbackIcon: "bolt", rendersAsTemplate: false),
        ProviderChoice(id: "mistral", title: "provider.mistral", assetName: "provider-mistral", assetExtension: "png", fallbackIcon: "wind", rendersAsTemplate: false),
        ProviderChoice(id: "custom", title: "provider.custom", assetName: nil, fallbackIcon: "slider.horizontal.3"),
    ]

    static func displayName(for provider: String, language: UILanguage) -> String {
        guard providers.contains(where: { $0.id == provider }) else { return provider.capitalized }
        return AppLocalization.string("provider.\(provider)", language: language)
    }

    static func credential(for provider: String) -> CredentialAccount {
        switch provider {
        case "bailian": .bailian
        case "volcengine": .volcengine
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
            "bailian": BailianRealtimeProvider.defaultModel,
            "volcengine": VolcengineRealtimeProvider.model,
            "openai": "gpt-4o-mini-transcribe",
            "deepgram": "nova-3",
            "soniox": "stt-rt-v4",
            "assemblyai": "universal-streaming-multilingual",
            "groq": "whisper-large-v3-turbo",
            "mistral": "voxtral-mini-latest",
        ][provider]
    }

    static func model(
        afterSelecting provider: String,
        current: String,
        rememberedBailianModel: String? = nil
    ) -> String {
        if provider == "bailian" {
            return BailianASRModel(rawValue: current)?.rawValue
                ?? rememberedBailianModel.flatMap(BailianASRModel.init(rawValue:))?.rawValue
                ?? BailianRealtimeProvider.defaultModel
        }
        if provider == "volcengine" { return VolcengineRealtimeProvider.model }
        guard let fallback = defaultModel(for: provider) else { return current }
        let knownDefaults = Set(providers.compactMap { defaultModel(for: $0.id) })
            .union(BailianASRModel.allCases.map(\.rawValue))
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
