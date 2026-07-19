import AppKit
import SwiftUI

enum OnboardingStep: Int, CaseIterable, Identifiable {
    case welcome
    case permissions
    case hotkey
    case tryIt

    var id: Int { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .welcome: "onboarding.step.welcome"
        case .permissions: "onboarding.step.permissions"
        case .hotkey: "onboarding.step.hotkey"
        case .tryIt: "onboarding.step.try"
        }
    }

    var icon: String {
        switch self {
        case .welcome: "sparkles"
        case .permissions: "checkmark.shield"
        case .hotkey: "keyboard"
        case .tryIt: "waveform"
        }
    }
}

enum OnboardingProgress {
    static func firstIncomplete(
        welcomeSeen: Bool,
        microphoneGranted: Bool,
        accessibilityGranted: Bool,
        hotkeyConfigured: Bool
    ) -> OnboardingStep {
        guard welcomeSeen else { return .welcome }
        guard microphoneGranted, accessibilityGranted else { return .permissions }
        guard hotkeyConfigured else { return .hotkey }
        return .tryIt
    }
}

private enum OnboardingVerificationState: Equatable {
    case idle
    case ready
    case recording
    case success
    case failed(String)
}

@MainActor
private final class OnboardingVerificationController: ObservableObject {
    @Published private(set) var state = OnboardingVerificationState.idle

    private let audio = AudioCaptureService()
    private let capsule = CapsuleController()
    private let hotkey = HotkeyService(swallowMatchedEvents: true)
    private let escape = HotkeyService(swallowMatchedEvents: true)
    private var selectedDeviceUID: String?
    private var sessionID: UUID?
    private var hideTask: Task<Void, Never>?

    func activate(key: String, selectedDeviceUID: String?, language: UILanguage) {
        deactivate()
        self.selectedDeviceUID = selectedDeviceUID
        capsule.setLanguage(language)
        capsule.setTarget(
            processIdentifier: ProcessInfo.processInfo.processIdentifier,
            applicationName: "Mouthpiece"
        )
        hotkey.onPress = { [weak self] in self?.toggleCapture() }
        escape.onPress = { [weak self] in self?.stopCapture() }
        do {
            try hotkey.start(key: key)
            try escape.start(key: "Escape")
            state = .ready
        } catch {
            hotkey.stop()
            escape.stop()
            state = .failed(error.localizedDescription)
        }
    }

    func deactivate() {
        hideTask?.cancel()
        hideTask = nil
        hotkey.stop()
        escape.stop()
        sessionID = nil
        if audio.isRunning {
            Task { await audio.stop() }
        }
        capsule.hide()
        state = .idle
    }

    private func toggleCapture() {
        if state == .recording {
            stopCapture()
        } else if state == .ready || state == .success {
            startCapture()
        }
    }

    private func startCapture() {
        hideTask?.cancel()
        let id = UUID()
        sessionID = id
        let snapshot = DictationSnapshot(
            sessionID: id,
            phase: .recording,
            partialText: "",
            audioLevel: 0,
            errorMessage: nil,
            isTranslation: false
        )
        capsule.show(snapshot)
        do {
            try audio.start(
                selectedDeviceUID: selectedDeviceUID,
                onFrame: { _ in },
                onLevel: { [weak self] level in
                    Task { @MainActor in self?.updateLevel(level, sessionID: id) }
                }
            )
            state = .recording
        } catch {
            sessionID = nil
            capsule.hide()
            state = .failed(error.localizedDescription)
        }
    }

    private func updateLevel(_ level: Float, sessionID: UUID) {
        guard self.sessionID == sessionID, state == .recording else { return }
        capsule.updateAudioLevel(level, sessionID: sessionID)
    }

    private func stopCapture() {
        guard state == .recording, let id = sessionID else { return }
        sessionID = nil
        state = .success
        Task {
            await audio.stop()
            guard state == .success else { return }
            capsule.show(DictationSnapshot(
                sessionID: id,
                phase: .completed,
                partialText: "",
                audioLevel: 0,
                errorMessage: nil,
                isTranslation: false
            ))
            hideTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(900))
                guard !Task.isCancelled else { return }
                self?.capsule.hide()
            }
        }
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @AppStorage("onboarding.welcomeSeen") private var welcomeSeen = false
    @AppStorage("onboarding.hotkeyConfigured") private var hotkeyConfigured = false
    @AppStorage("controlPanel.selectedSection") private var storedSection = ControlPanelSection.usage.rawValue

    @StateObject private var verification = OnboardingVerificationController()
    @State private var step = OnboardingStep.welcome
    @State private var selectedHotkey: String?
    @State private var isHotkeyCapturePresented = false

    private static let hotkeyPresets = [
        "RightCommand",
        "RightShift",
        "RightOption",
        "RightControl",
    ]

    var body: some View {
        HStack(spacing: 0) {
            stepSidebar
                .frame(width: 184)
            Divider()
            VStack(spacing: 0) {
                if let error = environment.startupError {
                    startupErrorBanner(error)
                }
                ScrollView {
                    VStack(alignment: step == .welcome ? .center : .leading, spacing: 24) {
                        if step != .welcome { header }
                        stepContent
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 28)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 590, alignment: step == .welcome ? .center : .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                footer
            }
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .frame(minWidth: 760, minHeight: 560)
        .background(OnboardingWindowConfiguration())
        .sheet(isPresented: $isHotkeyCapturePresented) {
            HotkeyCaptureSheet { selectedHotkey = $0 }
                .environmentObject(environment)
        }
        .task { restoreProgress() }
        .onChange(of: step) { _, next in
            if next == .tryIt {
                activateVerification()
            } else {
                verification.deactivate()
            }
        }
        .onDisappear {
            verification.deactivate()
            if environment.settings.onboardingCompleted {
                environment.resumeHotkeysAfterCapture()
            }
        }
    }

    private var stepSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                MouthpieceBrandIcon(size: 22)
                Text("Mouthpiece")
                    .font(.headline)
            }
            .padding(.horizontal, 16)
            .padding(.top, 26)
            .padding(.bottom, 18)

            VStack(spacing: 6) {
                ForEach(OnboardingStep.allCases) { item in
                    Button {
                        if canNavigate(to: item) { step = item }
                    } label: {
                        HStack(spacing: 10) {
                            stepIndicator(for: item)
                            Text(item.title)
                                .font(.body)
                            Spacer()
                        }
                        .padding(.horizontal, 11)
                        .frame(height: 36)
                        .contentShape(Rectangle())
                        .background {
                            if item == step {
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(Color.accentColor.opacity(0.11))
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(item == step ? Color.accentColor : Color.primary)
                    .disabled(!canNavigate(to: item))
                }
            }
            .padding(.horizontal, 10)
            Spacer()
        }
        .background(SidebarGlassBackground())
    }

    @ViewBuilder
    private func stepIndicator(for item: OnboardingStep) -> some View {
        if isComplete(item) {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.tint)
                .frame(width: 18)
        } else if item == step {
            Image(systemName: item.icon)
                .foregroundStyle(.tint)
                .frame(width: 18)
        } else {
            Image(systemName: "circle")
                .foregroundStyle(.tertiary)
                .frame(width: 18)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(stepTitle)
                .font(.title2.weight(.semibold))
            Text(stepSubtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case .welcome: welcomeContent
        case .permissions: permissionsContent
        case .hotkey: hotkeyContent
        case .tryIt: tryItContent
        }
    }

    private var welcomeContent: some View {
        VStack(spacing: 18) {
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .scaledToFit()
                .frame(width: 80, height: 80)
            VStack(spacing: 7) {
                Text("onboarding.welcome.title")
                    .font(.largeTitle.weight(.semibold))
                Text("onboarding.welcome.body")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 430)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 410, alignment: .center)
    }

    private var permissionsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            PermissionRows()
            if !permissionsReady {
                Label("onboarding.permissions.bothRequired", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var hotkeyContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("onboarding.hotkey.choose")
                .font(.subheadline.weight(.semibold))
                .padding(.leading, 2)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(Self.hotkeyPresets, id: \.self) { value in
                    hotkeyOption(value)
                }
            }
            Button {
                isHotkeyCapturePresented = true
            } label: {
                HStack(spacing: 11) {
                    Image(systemName: "keyboard.badge.ellipsis")
                        .font(.system(size: 18))
                        .foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("onboarding.hotkey.custom")
                            .font(.body.weight(.medium))
                        Text("onboarding.hotkey.customDetail")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    if let selectedHotkey, !Self.hotkeyPresets.contains(selectedHotkey) {
                        Text(verbatim: hotkeyName(selectedHotkey))
                            .font(.system(.body, design: .monospaced).weight(.medium))
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.tint)
                    } else {
                        Image(systemName: "chevron.right")
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.horizontal, 14)
                .frame(height: 62)
                .background(Color(nsColor: .controlBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.primary.opacity(0.08), lineWidth: 0.5)
                }
            }
            .buttonStyle(.plain)
        }
    }

    private func hotkeyOption(_ value: String) -> some View {
        Button { selectedHotkey = value } label: {
            HStack(spacing: 10) {
                Image(systemName: "keyboard")
                    .foregroundStyle(selectedHotkey == value ? Color.accentColor : Color.secondary)
                Text(verbatim: hotkeyName(value))
                    .font(.body.weight(.medium))
                Spacer()
                if selectedHotkey == value {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.tint)
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 54)
            .background(
                selectedHotkey == value
                    ? Color.accentColor.opacity(0.1)
                    : Color(nsColor: .controlBackgroundColor)
            )
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(
                        selectedHotkey == value ? Color.accentColor.opacity(0.65) : Color.primary.opacity(0.08),
                        lineWidth: selectedHotkey == value ? 1.2 : 0.5
                    )
            }
        }
        .buttonStyle(.plain)
    }

    private var tryItContent: some View {
        SettingsSection(title: "onboarding.try.status") {
            HStack(spacing: 14) {
                Image(systemName: verificationIcon)
                    .font(.system(size: 25))
                    .foregroundStyle(verificationColor)
                    .frame(width: 34)
                VStack(alignment: .leading, spacing: 4) {
                    Text(verificationTitle)
                        .font(.body.weight(.medium))
                    verificationDetail
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 16)
                if let selectedHotkey {
                    Text(verbatim: hotkeyName(selectedHotkey))
                        .font(.system(.body, design: .monospaced).weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color(nsColor: .controlBackgroundColor))
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
            }
            .padding(14)
        }
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Button("onboarding.back") {
                if let previous = OnboardingStep(rawValue: step.rawValue - 1) {
                    step = previous
                }
            }
            .disabled(step == .welcome)

            Spacer()

            Button(primaryActionTitle) { advance() }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .disabled(!canAdvance)
        }
        .padding(.horizontal, 20)
        .frame(height: 60)
    }

    private var stepTitle: LocalizedStringKey {
        switch step {
        case .welcome: "onboarding.welcome.title"
        case .permissions: "onboarding.permissions.title"
        case .hotkey: "onboarding.hotkey.title"
        case .tryIt: "onboarding.try.title"
        }
    }

    private var stepSubtitle: LocalizedStringKey {
        switch step {
        case .welcome: "onboarding.welcome.body"
        case .permissions: "onboarding.permissions.body"
        case .hotkey: "onboarding.hotkey.body"
        case .tryIt: "onboarding.try.body"
        }
    }

    private var primaryActionTitle: LocalizedStringKey {
        step == .tryIt ? "onboarding.finish" : "onboarding.continue"
    }

    private var permissionsReady: Bool {
        environment.permissions.microphone && environment.permissions.accessibility
    }

    private var canAdvance: Bool {
        switch step {
        case .welcome: true
        case .permissions: permissionsReady
        case .hotkey: selectedHotkey != nil
        case .tryIt: verification.state == .success
        }
    }

    private var verificationTitle: LocalizedStringKey {
        switch verification.state {
        case .recording: "onboarding.try.recording"
        case .success: "onboarding.try.success"
        case .failed: "onboarding.try.failedTitle"
        default: "onboarding.try.ready"
        }
    }

    private var verificationDetail: Text {
        switch verification.state {
        case .recording:
            Text("onboarding.try.stopHint")
        case .success:
            Text("onboarding.try.successDetail")
        case .failed(let message):
            Text(verbatim: message)
        default:
            Text("onboarding.try.shortcutHint")
        }
    }

    private var verificationIcon: String {
        switch verification.state {
        case .recording: "waveform"
        case .success: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        default: "keyboard"
        }
    }

    private var verificationColor: Color {
        switch verification.state {
        case .success: .green
        case .failed: .red
        default: .accentColor
        }
    }

    private func advance() {
        switch step {
        case .welcome:
            welcomeSeen = true
            step = .permissions
        case .permissions:
            step = .hotkey
        case .hotkey:
            guard let selectedHotkey else { return }
            var settings = environment.settings
            settings.dictationKey = selectedHotkey
            environment.saveSettings(settings)
            hotkeyConfigured = true
            environment.suspendHotkeysForCapture()
            step = .tryIt
        case .tryIt:
            guard verification.state == .success else { return }
            storedSection = ControlPanelSection.dictation.rawValue
            verification.deactivate()
            environment.completeOnboarding()
        }
    }

    private func isComplete(_ item: OnboardingStep) -> Bool {
        switch item {
        case .welcome: welcomeSeen
        case .permissions: permissionsReady
        case .hotkey: hotkeyConfigured
        case .tryIt: verification.state == .success
        }
    }

    private func canNavigate(to item: OnboardingStep) -> Bool {
        switch item {
        case .welcome: true
        case .permissions: welcomeSeen
        case .hotkey: welcomeSeen && permissionsReady
        case .tryIt: welcomeSeen && permissionsReady && hotkeyConfigured
        }
    }

    private func restoreProgress() {
        environment.refreshPermissions()
        selectedHotkey = hotkeyConfigured ? environment.settings.dictationKey : nil
        step = OnboardingProgress.firstIncomplete(
            welcomeSeen: welcomeSeen,
            microphoneGranted: environment.permissions.microphone,
            accessibilityGranted: environment.permissions.accessibility,
            hotkeyConfigured: hotkeyConfigured
        )
        environment.suspendHotkeysForCapture()
        if step == .tryIt { activateVerification() }
    }

    private func activateVerification() {
        guard hotkeyConfigured else { return }
        environment.suspendHotkeysForCapture()
        verification.activate(
            key: environment.settings.dictationKey,
            selectedDeviceUID: environment.settings.selectedMicrophoneUID.isEmpty
                ? nil : environment.settings.selectedMicrophoneUID,
            language: environment.settings.uiLanguage
        )
    }

    private func hotkeyName(_ value: String) -> String {
        HotkeyCapture.displayName(for: value, language: environment.settings.uiLanguage)
    }

    private func startupErrorBanner(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.caption)
                .lineLimit(2)
            Spacer()
            Button {
                environment.dismissStartupError()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
            .help("common.close")
            .accessibilityLabel("common.close")
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 40)
        .background(Color.red.opacity(0.08))
    }
}

private struct OnboardingWindowConfiguration: NSViewRepresentable {
    final class WindowProbe: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            OnboardingWindowConfiguration.configure(window)
        }
    }

    func makeNSView(context: Context) -> WindowProbe {
        WindowProbe(frame: .zero)
    }

    func updateNSView(_ nsView: WindowProbe, context: Context) {}

    static func dismantleNSView(_ nsView: WindowProbe, coordinator: ()) {
        guard let window = nsView.window else { return }
        window.standardWindowButton(.zoomButton)?.isEnabled = true
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.toolbar?.isVisible = false
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
    }

    @MainActor
    private static func configure(_ window: NSWindow) {
        window.setContentSize(NSSize(width: 820, height: 600))
        window.minSize = NSSize(width: 760, height: 560)
        window.standardWindowButton(.zoomButton)?.isEnabled = false
        window.collectionBehavior.remove(.fullScreenPrimary)
        window.toolbar?.isVisible = false
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        window.center()
    }
}
