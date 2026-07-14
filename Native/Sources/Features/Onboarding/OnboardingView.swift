import AppKit
import SwiftUI

enum OnboardingStep: Int, CaseIterable, Identifiable {
    case welcome
    case permissions
    case service
    case tryIt

    var id: Int { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .welcome: "onboarding.step.welcome"
        case .permissions: "onboarding.step.permissions"
        case .service: "onboarding.step.service"
        case .tryIt: "onboarding.step.try"
        }
    }

    var icon: String {
        switch self {
        case .welcome: "waveform"
        case .permissions: "checkmark.shield"
        case .service: "server.rack"
        case .tryIt: "mic"
        }
    }
}

enum OnboardingProgress {
    static func firstIncomplete(
        welcomeSeen: Bool,
        microphoneGranted: Bool,
        serviceReady: Bool
    ) -> OnboardingStep {
        guard welcomeSeen else { return .welcome }
        guard microphoneGranted else { return .permissions }
        guard serviceReady else { return .service }
        return .tryIt
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @AppStorage("onboarding.welcomeSeen") private var welcomeSeen = false

    @State private var step = OnboardingStep.welcome
    @State private var credentialConfigured = false
    @State private var localModelReady = false
    @State private var testResult = ""
    @State private var testError = ""
    @State private var testSucceeded = false
    @State private var historyIDsAtTestStart = Set<Int64>()
    @State private var awaitingTestResult = false

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
                    VStack(alignment: .leading, spacing: 24) {
                        header
                        stepContent
                    }
                    .padding(.horizontal, 32)
                    .padding(.top, 28)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 590, alignment: .leading)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                footer
            }
            .background(Color(nsColor: .windowBackgroundColor))
        }
        .frame(minWidth: 760, minHeight: 560)
        .background(OnboardingWindowConfiguration())
        .task { await restoreProgress() }
        .onChange(of: environment.dictation) { _, snapshot in
            updateTestState(snapshot)
        }
        .onChange(of: environment.transcriptions) { _, records in
            updateTestResult(from: records)
        }
    }

    private var stepSidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "waveform")
                    .font(.system(size: 17, weight: .semibold))
                Text("Mouthpiece")
                    .font(.headline)
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 22)

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
        case .welcome:
            welcomeContent
        case .permissions:
            permissionsContent
        case .service:
            serviceContent
        case .tryIt:
            tryItContent
        }
    }

    private var welcomeContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 64))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.tint)
            VStack(alignment: .leading, spacing: 10) {
                Text("onboarding.welcome.anywhere")
                    .font(.title3.weight(.medium))
                HStack(spacing: 10) {
                    Text("onboarding.welcome.shortcut")
                        .foregroundStyle(.secondary)
                    Text(
                        HotkeyCapture.displayName(
                            for: environment.settings.dictationKey,
                            language: environment.settings.uiLanguage
                        )
                    )
                        .font(.system(.body, design: .monospaced).weight(.medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color(nsColor: .controlBackgroundColor))
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
            }
        }
        .padding(.top, 18)
    }

    private var permissionsContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            PermissionRows()
            if !environment.permissions.microphone {
                Label("onboarding.permissions.microphoneRequired", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if !environment.permissions.accessibility {
                Label("onboarding.permissions.accessibilityOptional", systemImage: "info.circle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var serviceContent: some View {
        VStack(alignment: .leading, spacing: 12) {
            SettingsSection(title: "onboarding.service.configuration") {
                TranscriptionModePicker()
                if environment.settings.useLocalTranscription {
                    LocalTranscriptionRows { localModelReady = $0 }
                } else {
                    CloudTranscriptionRows { credentialConfigured = $0 }
                }
            }
            if serviceReady {
                InlineStatus("onboarding.service.ready", kind: .success)
            } else {
                InlineStatus(
                    environment.settings.useLocalTranscription
                        ? "onboarding.service.localRequired"
                        : "onboarding.service.credentialRequired",
                    kind: .warning
                )
            }
        }
    }

    private var tryItContent: some View {
        VStack(alignment: .leading, spacing: 18) {
            SettingsSection(title: "onboarding.try.status") {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        Image(systemName: testSucceeded ? "checkmark.circle.fill" : "waveform")
                            .font(.system(size: 24))
                            .foregroundStyle(testSucceeded ? Color.green : Color.accentColor)
                            .frame(width: 32)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(dictationStatusTitle)
                                .font(.body.weight(.medium))
                            Text("onboarding.try.shortcutHint")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button {
                            if environment.dictation.phase.isActive {
                                environment.stopDictation()
                            } else {
                                testResult = ""
                                testError = ""
                                testSucceeded = false
                                historyIDsAtTestStart = Set(environment.transcriptions.map(\.id))
                                awaitingTestResult = true
                                environment.startDictation()
                            }
                        } label: {
                            Text(
                                environment.dictation.phase.isActive
                                    ? LocalizedStringKey("onboarding.try.stop")
                                    : LocalizedStringKey("onboarding.try.start")
                            )
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!serviceReady || !environment.permissions.microphone)
                    }

                    if !displayedTranscript.isEmpty {
                        Text(displayedTranscript)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12)
                            .background(Color(nsColor: .textBackgroundColor))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }

                    if !testError.isEmpty {
                        InlineStatus(verbatim: testError, kind: .error)
                    }
                }
                .padding(14)
            }

            if !environment.permissions.accessibility {
                Label("onboarding.try.noInsertion", systemImage: "accessibility")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
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

            if step == .service {
                Button("onboarding.setupLater") { environment.completeOnboarding() }
            } else if step == .tryIt {
                Button("onboarding.tryLater") { environment.completeOnboarding() }
            }

            Button(primaryActionTitle) {
                advance()
            }
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
        case .service: "onboarding.provider.title"
        case .tryIt: "onboarding.try.title"
        }
    }

    private var stepSubtitle: LocalizedStringKey {
        switch step {
        case .welcome: "onboarding.welcome.body"
        case .permissions: "onboarding.permissions.body"
        case .service: "onboarding.provider.body"
        case .tryIt: "onboarding.try.body"
        }
    }

    private var primaryActionTitle: LocalizedStringKey {
        step == .tryIt ? "onboarding.finish" : "onboarding.continue"
    }

    private var canAdvance: Bool {
        switch step {
        case .welcome: true
        case .permissions: environment.permissions.microphone
        case .service: serviceReady
        case .tryIt: testSucceeded
        }
    }

    private var serviceReady: Bool {
        environment.settings.useLocalTranscription ? localModelReady : credentialConfigured
    }

    private var displayedTranscript: String {
        if !environment.dictation.partialText.isEmpty { return environment.dictation.partialText }
        return testResult
    }

    private var dictationStatusTitle: LocalizedStringKey {
        if testSucceeded { return "onboarding.try.success" }
        return switch environment.dictation.phase {
        case .preparing: "capsule.preparing"
        case .recording: "capsule.listening"
        case .stopping, .finalizing: "capsule.transcribing"
        case .inserting: "capsule.inserting"
        case .failed: "capsule.failed"
        default: "onboarding.try.ready"
        }
    }

    private func advance() {
        if step == .welcome { welcomeSeen = true }
        if step == .tryIt {
            environment.completeOnboarding()
        } else if let next = OnboardingStep(rawValue: step.rawValue + 1) {
            step = next
        }
    }

    private func isComplete(_ item: OnboardingStep) -> Bool {
        switch item {
        case .welcome: welcomeSeen || step.rawValue > item.rawValue
        case .permissions: environment.permissions.microphone
        case .service: serviceReady
        case .tryIt: testSucceeded
        }
    }

    private func canNavigate(to item: OnboardingStep) -> Bool {
        switch item {
        case .welcome: true
        case .permissions: welcomeSeen
        case .service: welcomeSeen && environment.permissions.microphone
        case .tryIt: welcomeSeen && environment.permissions.microphone && serviceReady
        }
    }

    private func restoreProgress() async {
        environment.refreshPermissions()
        localModelReady = environment.selectedLocalModelInstalled
        let account = CloudTranscriptionSupport.credential(for: environment.settings.cloudTranscriptionProvider)
        credentialConfigured = !(await environment.credential(account)).isEmpty

        step = OnboardingProgress.firstIncomplete(
            welcomeSeen: welcomeSeen,
            microphoneGranted: environment.permissions.microphone,
            serviceReady: serviceReady
        )
    }

    private func updateTestState(_ snapshot: DictationSnapshot) {
        if snapshot.phase == .completed, !snapshot.partialText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            testResult = snapshot.partialText
            testSucceeded = true
            testError = ""
            awaitingTestResult = false
        } else if snapshot.phase == .failed {
            testError = snapshot.errorMessage ?? AppLocalization.string(
                "onboarding.try.failed",
                language: environment.settings.uiLanguage
            )
            testSucceeded = false
            awaitingTestResult = false
        }
    }

    private func updateTestResult(from records: [TranscriptionRecord]) {
        guard awaitingTestResult,
              !testSucceeded,
              let record = records.first(where: { !historyIDsAtTestStart.contains($0.id) }) else { return }
        testResult = record.text
        testSucceeded = !record.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if testSucceeded {
            testError = ""
            awaitingTestResult = false
        }
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
    }

    @MainActor
    private static func configure(_ window: NSWindow) {
        window.setContentSize(NSSize(width: 820, height: 600))
        window.minSize = NSSize(width: 760, height: 560)
        window.standardWindowButton(.zoomButton)?.isEnabled = false
        window.collectionBehavior.remove(.fullScreenPrimary)
        window.center()
    }

}
