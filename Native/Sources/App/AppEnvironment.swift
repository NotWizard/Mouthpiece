import AppKit
import Foundation
import ServiceManagement

@MainActor
final class AppEnvironment: ObservableObject {
    @Published private(set) var isReady = false
    @Published private(set) var settings = AppSettings()
    @Published private(set) var dictation = DictationSnapshot.idle
    @Published private(set) var transcriptions: [TranscriptionRecord] = []
    @Published private(set) var permissions = PermissionSnapshot(microphone: false, accessibility: false)
    @Published private(set) var microphones: [AudioInputDevice] = []
    @Published private(set) var dictionaryWords: [String] = []
    @Published private(set) var selectedLocalModelInstalled = false
    @Published private(set) var modelInstallationState = ModelInstallationState.idle
    @Published private(set) var startupError: String?

    let settingsRepository = SettingsRepository()
    let keychain = KeychainStore()
    let audio = AudioCaptureService()
    let audioCues = AudioCueService()
    let permissionsService = PermissionService()
    let insertion = TextInsertionService()
    let capsule = CapsuleController()
    let hotkey = HotkeyService()
    let translationHotkey = HotkeyService(swallowMatchedEvents: true)
    let escapeHotkey = HotkeyService(swallowMatchedEvents: true)
    let modelInstaller = LocalModelInstallationService()
    let updates = UpdateController()

    private var history: HistoryRepository?
    private var logger: DebugLogStore?
    private var coordinator: DictationCoordinator?
    private var hotkeyPressedAt: ContinuousClock.Instant?
    private var pendingMainHotkeyTask: Task<Void, Never>?
    private var mainHotkeyActivationPending = false
    private var toggleDictationObserver: NSObjectProtocol?
    private var applicationObservers: [NSObjectProtocol] = []
    private var workspaceObservers: [NSObjectProtocol] = []
    private var escapeLocalMonitor: Any?
    private var activeActivation: DictationActivation = .main
    private var isShuttingDown = false
    private var localModelStatusRequest = 0
    private var dictionarySaveRevision = 0
    private var dictionarySaveTask: Task<Void, Never>?

    init(bootstrap: Bool = true) {
        toggleDictationObserver = NotificationCenter.default.addObserver(
            forName: .mouthpieceToggleDictation,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.toggleDictation() }
        }
        registerLifecycleObservers()
        AppDelegate.shutdownHandler = { [weak self] in
            await self?.shutdown()
        }
        if bootstrap {
            Task { await initialize() }
        } else {
            isReady = true
        }
    }

    func saveSettings(_ next: AppSettings) {
        do {
            let previous = settings
            try settingsRepository.save(next)
            settings = settingsRepository.load()
            let changes = RuntimeSettingsChanges(previous: previous, current: settings)
            if changes.debugLogging {
                Task { await logger?.setEnabled(settings.debugLoggingEnabled) }
            }
            if changes.hotkeys {
                cancelPendingMainHotkey()
                updateHotkeyRegistrations()
            }
            if changes.systemIntegrations { applySystemSettings() }
            if changes.localModel { refreshLocalModelStatus() }
        } catch {
            startupError = error.localizedDescription
        }
    }

    func refreshHistory() {
        Task {
            do {
                try await reloadHistory()
            } catch {
                startupError = error.localizedDescription
            }
        }
    }

    func clearHistory() {
        Task {
            do {
                guard let history else { return }
                try await history.clear()
                try await reloadHistory()
            } catch {
                startupError = error.localizedDescription
            }
        }
    }

    func deleteTranscription(_ id: Int64) {
        Task {
            do {
                guard let history else { return }
                try await history.delete(id: id)
                try await reloadHistory()
            } catch {
                startupError = error.localizedDescription
            }
        }
    }

    func restoreTranscription(_ record: TranscriptionRecord) {
        Task {
            do {
                guard let history else { return }
                try await history.restore(record)
                try await reloadHistory()
            } catch {
                startupError = error.localizedDescription
            }
        }
    }

    func saveDictionary(_ words: [String]) {
        var next = settings
        next.terminologyProfile.preferredTerms = words
        next.normalize()
        let normalizedWords = next.terminologyProfile.preferredTerms
        saveSettings(next)
        guard settings.terminologyProfile.preferredTerms == normalizedWords else { return }
        dictionaryWords = normalizedWords

        dictionarySaveRevision += 1
        let revision = dictionarySaveRevision
        let previousSave = dictionarySaveTask
        dictionarySaveTask = Task { [weak self] in
            await previousSave?.value
            guard let self else { return }
            defer {
                if revision == self.dictionarySaveRevision {
                    self.dictionarySaveTask = nil
                }
            }
            guard let history = self.history else { return }
            do {
                try await history.replaceDictionary(normalizedWords)
            } catch {
                guard revision == self.dictionarySaveRevision else { return }
                self.startupError = error.localizedDescription
            }
        }
    }

    func credential(_ account: CredentialAccount) async throws -> String {
        try await keychain.read(account) ?? ""
    }

    func saveCredential(_ value: String, account: CredentialAccount) async throws {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if clean.isEmpty {
            try await keychain.delete(account)
        } else {
            try await keychain.write(clean, for: account)
        }
        if account == .bailian { await coordinator?.warmup(settings: settings) }
    }

    func requestMicrophonePermission() {
        Task {
            _ = await permissionsService.requestMicrophone()
            refreshPermissions()
        }
    }

    func requestAccessibilityPermission() {
        permissionsService.requestAccessibility(language: settings.uiLanguage) { [weak self] in
            self?.refreshPermissions()
        }
    }

    func openMicrophoneSettings() { permissionsService.openMicrophoneSettings() }
    func openAccessibilitySettings() { permissionsService.openAccessibilitySettings() }

    func refreshPermissions() {
        permissions = permissionsService.current()
        updateHotkeyRegistrations()
    }

    func shutdown() async {
        guard !isShuttingDown else { return }
        isShuttingDown = true
        hotkey.stop()
        translationHotkey.stop()
        escapeHotkey.stop()
        stopEscapeLocalMonitor()
        cancelPendingMainHotkey()
        hotkeyPressedAt = nil
        await dictionarySaveTask?.value
        await coordinator?.shutdown()
        await logger?.write(.info, "Application shutdown completed")
    }

    func completeOnboarding() {
        var next = settings
        next.onboardingCompleted = true
        saveSettings(next)
    }

    func report(_ error: Error) { startupError = error.localizedDescription }

    func dismissStartupError() { startupError = nil }
    func checkForUpdates() { updates.checkForUpdates() }

    func suspendHotkeysForCapture() {
        cancelPendingMainHotkey()
        hotkey.stop()
        translationHotkey.stop()
        escapeHotkey.stop()
        stopEscapeLocalMonitor()
    }

    func resumeHotkeysAfterCapture() {
        updateHotkeyRegistrations()
    }

    func refreshLocalModelStatus() {
        let provider = settings.localTranscriptionProvider
        let model = selectedLocalModelID
        localModelStatusRequest += 1
        let request = localModelStatusRequest
        selectedLocalModelInstalled = false
        if modelInstallationState.modelID != nil, modelInstallationState.modelID != model {
            modelInstallationState = .idle
        }
        Task {
            let installed = await modelInstaller.isInstalled(provider: provider, model: model)
            guard request == localModelStatusRequest,
                  provider == settings.localTranscriptionProvider,
                  model == selectedLocalModelID else { return }
            selectedLocalModelInstalled = installed
        }
    }

    func installSelectedLocalModel() {
        let provider = settings.localTranscriptionProvider
        let model = selectedLocalModelID
        Task {
            do {
                try await modelInstaller.install(provider: provider, model: model) { [weak self] state in
                    Task { @MainActor in
                        guard let self,
                              provider == self.settings.localTranscriptionProvider,
                              model == self.selectedLocalModelID else { return }
                        self.modelInstallationState = state
                    }
                }
                refreshLocalModelStatus()
            } catch {
                guard provider == settings.localTranscriptionProvider,
                      model == selectedLocalModelID else { return }
                modelInstallationState = .failed(model: model, message: error.localizedDescription)
            }
        }
    }

    func removeSelectedLocalModel() {
        let provider = settings.localTranscriptionProvider
        let model = selectedLocalModelID
        Task {
            do {
                try await modelInstaller.remove(provider: provider, model: model)
                guard provider == settings.localTranscriptionProvider,
                      model == selectedLocalModelID else { return }
                modelInstallationState = .idle
                refreshLocalModelStatus()
            } catch {
                guard provider == settings.localTranscriptionProvider,
                      model == selectedLocalModelID else { return }
                modelInstallationState = .failed(model: model, message: error.localizedDescription)
            }
        }
    }

    func startDictation(translation: Bool = false) {
        guard let coordinator else { return }
        activeActivation = translation ? .translation : .main
        if settings.audioCuesEnabled { audioCues.playStart(preset: settings.soundPreset) }
        var sessionSettings = settings
        sessionSettings.translationEnabled = translation
        Task { await coordinator.start(settings: sessionSettings) }
    }

    func stopDictation() {
        guard let coordinator else { return }
        if settings.audioCuesEnabled { audioCues.playStop(preset: settings.soundPreset) }
        Task {
            await coordinator.stop()
            refreshHistory()
        }
    }

    func cancelDictation() {
        guard let coordinator else { return }
        if settings.audioCuesEnabled { audioCues.playStop(preset: settings.soundPreset) }
        Task { await coordinator.cancel() }
    }

    private func initialize() async {
        do {
            try AppPaths.prepareApplicationSupport()
            if ProcessInfo.processInfo.environment["MOUTHPIECE_SKIP_LEGACY_MIGRATION"] != "1" {
                _ = try await LegacyMigrationCoordinator().run(
                    settings: settingsRepository,
                    keychain: keychain
                )
            }
            settings = settingsRepository.load()
            let history = try HistoryRepository()
            self.history = history
            let logger = DebugLogStore(enabled: settings.debugLoggingEnabled)
            self.logger = logger
            try await logger.prune()
            transcriptions = try await history.recent(limit: 200)
            let storedDictionary = try await history.dictionary()
            dictionaryWords = settings.terminologyProfile.preferredTerms
            if storedDictionary != dictionaryWords {
                try await history.replaceDictionary(dictionaryWords)
            }
            microphones = audio.availableInputDevices()
            permissions = permissionsService.current()

            let coordinator = DictationCoordinator(
                audio: audio,
                history: history,
                keychain: keychain,
                logger: logger,
                insertion: insertion,
                capsule: capsule
            ) { [weak self] snapshot in
                self?.dictation = snapshot
            }
            self.coordinator = coordinator
            hotkey.onPress = { [weak self] in self?.handleHotkeyPress() }
            hotkey.onRelease = { [weak self] in self?.handleHotkeyRelease() }
            escapeHotkey.onPress = { [weak self] in self?.handleEscape(53) }
            translationHotkey.onPress = { [weak self] in self?.handleTranslationHotkeyPress() }
            updateHotkeyRegistrations()
            applySystemSettings()
            refreshLocalModelStatus()
            isReady = true
            Task { await coordinator.warmup(settings: settings) }
        } catch {
            startupError = error.localizedDescription
            isReady = true
        }
    }

    private func reloadHistory() async throws {
        guard let history else { return }
        transcriptions = try await history.recent(limit: 200)
    }

    private var selectedLocalModelID: String {
        switch settings.localTranscriptionProvider {
        case .whisper: settings.whisperModel
        case .parakeet: settings.parakeetModel.isEmpty ? "parakeet-tdt-0.6b-v3" : settings.parakeetModel
        case .qwen: settings.qwenASRModel
        }
    }

    private func applySystemSettings() {
        NSApp.setActivationPolicy(settings.showInDock ? .regular : .accessory)
        capsule.setLanguage(settings.uiLanguage)
        NotificationCenter.default.post(
            name: .mouthpieceRuntimeSettingsChanged,
            object: nil,
            userInfo: [
                "language": settings.uiLanguage.rawValue,
                "showInMenuBar": settings.showInMenuBar,
            ]
        )
        do {
            switch LaunchAtLoginAction.resolve(
                enabled: settings.launchAtLogin,
                status: SMAppService.mainApp.status
            ) {
            case .register:
                try SMAppService.mainApp.register()
            case .unregister:
                try SMAppService.mainApp.unregister()
            case .none:
                break
            }
        } catch {
            startupError = error.localizedDescription
        }
    }

    private func toggleDictation() {
        dictation.phase.isActive ? stopDictation() : startDictation(translation: false)
    }

    private func handleHotkeyPress() {
        hotkeyPressedAt = .now
        guard effectiveTranslationHotkey != nil, settings.translationEnabled else {
            performMainHotkeyPress()
            return
        }

        cancelPendingMainHotkey(resetPressTime: false)
        mainHotkeyActivationPending = true
        pendingMainHotkeyTask = Task { [weak self] in
            do {
                try await Task.sleep(for: .milliseconds(140))
            } catch {
                return
            }
            guard let self else { return }
            self.mainHotkeyActivationPending = false
            self.pendingMainHotkeyTask = nil
            self.performMainHotkeyPress()
        }
    }

    private func performMainHotkeyPress() {
        switch settings.hotkeyBehavior {
        case .toggle:
            dictation.phase.isActive ? stopDictation() : startDictation(translation: false)
        case .pushToTalk:
            if !dictation.phase.isActive { startDictation(translation: false) }
        case .automatic:
            dictation.phase.isActive ? stopDictation() : startDictation(translation: false)
        }
    }

    private func handleHotkeyRelease() {
        let shouldCompletePendingPress = mainHotkeyActivationPending
        cancelPendingMainHotkey(resetPressTime: false)
        if shouldCompletePendingPress {
            performMainHotkeyPress()
        }
        performMainHotkeyRelease()
    }

    private func performMainHotkeyRelease() {
        defer { hotkeyPressedAt = nil }
        guard activeActivation == .main else { return }
        switch settings.hotkeyBehavior {
        case .pushToTalk:
            stopDictation()
        case .automatic:
            guard let hotkeyPressedAt else { return }
            if hotkeyPressedAt.duration(to: .now) >= .milliseconds(450) {
                stopDictation()
            }
        case .toggle:
            break
        }
    }

    private func handleTranslationHotkeyPress() {
        guard settings.translationEnabled, effectiveTranslationHotkey != nil,
              hotkeyPressedAt != nil,
              let coordinator else { return }
        cancelPendingMainHotkey(resetPressTime: false)
        if dictation.phase.isActive, activeActivation == .translation {
            stopDictation()
            return
        }
        activeActivation = .translation
        if settings.audioCuesEnabled { audioCues.playStart(preset: settings.soundPreset) }
        var sessionSettings = settings
        sessionSettings.translationEnabled = true
        Task {
            if dictation.phase.isActive {
                await coordinator.cancel()
                try? await Task.sleep(for: .milliseconds(80))
            }
            await coordinator.start(settings: sessionSettings)
        }
    }

    private func updateHotkeyRegistrations() {
        updateEscapeHotkey()
        guard permissions.accessibility else {
            hotkey.stop()
            translationHotkey.stop()
            return
        }

        do {
            try hotkey.update(key: settings.dictationKey)
        } catch {
            hotkey.stop()
            translationHotkey.stop()
            startupError = error.localizedDescription
            return
        }
        updateTranslationHotkey()
    }

    private func updateTranslationHotkey() {
        guard permissions.accessibility,
              settings.translationEnabled,
              let key = effectiveTranslationHotkey else {
            translationHotkey.stop()
            return
        }
        do {
            try translationHotkey.update(key: key)
        } catch {
            translationHotkey.stop()
            startupError = error.localizedDescription
        }
    }

    nonisolated static func shouldCancelForEscape(keyCode: UInt16, enabled: Bool, isActive: Bool) -> Bool {
        keyCode == 53 && enabled && isActive
    }

    private func updateEscapeHotkey() {
        stopEscapeLocalMonitor()
        guard settings.escapeCancelsRecording else {
            escapeHotkey.stop()
            return
        }
        guard permissions.accessibility else {
            escapeHotkey.stop()
            installEscapeLocalMonitor()
            return
        }
        do {
            try escapeHotkey.update(key: "Escape")
        } catch {
            escapeHotkey.stop()
            startupError = error.localizedDescription
            installEscapeLocalMonitor()
        }
    }

    private func installEscapeLocalMonitor() {
        escapeLocalMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown, handler: { [weak self] event in
            let keyCode = event.keyCode
            Task { @MainActor in self?.handleEscape(keyCode) }
            return event
        })
    }

    private func stopEscapeLocalMonitor() {
        guard let escapeLocalMonitor else { return }
        NSEvent.removeMonitor(escapeLocalMonitor)
        self.escapeLocalMonitor = nil
    }

    private func handleEscape(_ keyCode: UInt16) {
        guard Self.shouldCancelForEscape(
            keyCode: keyCode,
            enabled: settings.escapeCancelsRecording,
            isActive: dictation.phase.isActive
        ) else { return }
        cancelPendingMainHotkey()
        Task { await logger?.write(.debug, "Escape cancellation requested") }
        cancelDictation()
    }

    private var effectiveTranslationHotkey: String? {
        TranslationHotkey.combination(
            dictationKey: settings.dictationKey,
            suffix: settings.translationHotkeySuffix
        )
    }

    private func cancelPendingMainHotkey(resetPressTime: Bool = true) {
        pendingMainHotkeyTask?.cancel()
        pendingMainHotkeyTask = nil
        mainHotkeyActivationPending = false
        if resetPressTime { hotkeyPressedAt = nil }
    }

    private func registerLifecycleObservers() {
        applicationObservers.append(NotificationCenter.default.addObserver(
            forName: NSApplication.didBecomeActiveNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.recoverSystemIntegrations(rewarmRealtime: false) }
        })

        let workspaceCenter = NSWorkspace.shared.notificationCenter
        workspaceObservers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.willSleepNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.prepareForSleep() }
        })
        workspaceObservers.append(workspaceCenter.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(400))
                self?.recoverSystemIntegrations(rewarmRealtime: true)
            }
        })
    }

    private func prepareForSleep() async {
        cancelPendingMainHotkey()
        hotkey.stop()
        translationHotkey.stop()
        escapeHotkey.stop()
        stopEscapeLocalMonitor()
        hotkeyPressedAt = nil
        await coordinator?.shutdown()
    }

    private func recoverSystemIntegrations(rewarmRealtime: Bool) {
        guard !isShuttingDown else { return }
        microphones = audio.availableInputDevices()
        refreshPermissions()
        capsule.repositionIfVisible()
        if rewarmRealtime, let coordinator {
            Task { await coordinator.warmup(settings: settings) }
        }
    }
}

private enum DictationActivation {
    case main
    case translation
}

enum LaunchAtLoginAction: Equatable {
    case register
    case unregister
    case none

    static func resolve(enabled: Bool, status: SMAppService.Status) -> Self {
        if enabled, status == .notRegistered { return .register }
        if !enabled, status == .enabled || status == .requiresApproval { return .unregister }
        return .none
    }
}

struct RuntimeSettingsChanges: Equatable {
    let debugLogging: Bool
    let hotkeys: Bool
    let systemIntegrations: Bool
    let localModel: Bool

    init(debugLogging: Bool, hotkeys: Bool, systemIntegrations: Bool, localModel: Bool) {
        self.debugLogging = debugLogging
        self.hotkeys = hotkeys
        self.systemIntegrations = systemIntegrations
        self.localModel = localModel
    }

    init(previous: AppSettings, current: AppSettings) {
        debugLogging = previous.debugLoggingEnabled != current.debugLoggingEnabled
        hotkeys = previous.dictationKey != current.dictationKey
            || previous.translationHotkeySuffix != current.translationHotkeySuffix
            || previous.translationEnabled != current.translationEnabled
            || previous.escapeCancelsRecording != current.escapeCancelsRecording
        systemIntegrations = previous.uiLanguage != current.uiLanguage
            || previous.launchAtLogin != current.launchAtLogin
            || previous.showInDock != current.showInDock
            || previous.showInMenuBar != current.showInMenuBar
        localModel = previous.useLocalTranscription != current.useLocalTranscription
            || previous.localTranscriptionProvider != current.localTranscriptionProvider
            || previous.whisperModel != current.whisperModel
            || previous.parakeetModel != current.parakeetModel
            || previous.qwenASRModel != current.qwenASRModel
    }
}

private extension ModelInstallationState {
    var modelID: String? {
        switch self {
        case .idle: nil
        case .installing(let model, _), .installed(let model), .failed(let model, _): model
        }
    }
}
