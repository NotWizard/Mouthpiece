import AppKit
import SwiftUI

struct SettingsPage<Content: View>: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
    var maxContentWidth: CGFloat = 760
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SettingsPageHeader(title: title, subtitle: subtitle)
                content
            }
            .padding(.horizontal, 28)
            .padding(.top, 24)
            .padding(.bottom, 28)
            .frame(maxWidth: maxContentWidth, alignment: .leading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
    }
}

struct SettingsPageHeader: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.title2.weight(.semibold))
            Text(subtitle)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }
}

struct SettingsSection<Content: View>: View {
    let title: LocalizedStringKey
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.leading, 2)
            VStack(spacing: 0) {
                content
            }
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color(nsColor: .separatorColor).opacity(0.45), lineWidth: 0.5)
            }
        }
    }
}

struct SettingsRow<Content: View>: View {
    let icon: String
    let title: LocalizedStringKey
    var detail: LocalizedStringKey?
    var showsDivider = true
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.body)
                if let detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 16)
            content
        }
        .padding(.horizontal, 13)
        .frame(minHeight: detail == nil ? 44 : 56)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Divider()
                    .padding(.leading, 44)
            }
        }
    }
}

enum InlineStatusKind: Equatable {
    case neutral
    case progress
    case success
    case warning
    case error

    var color: Color {
        switch self {
        case .neutral, .progress: .secondary
        case .success: .green
        case .warning: .orange
        case .error: .red
        }
    }

    var icon: String {
        switch self {
        case .neutral: "circle"
        case .progress: "circle"
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .error: "xmark.circle.fill"
        }
    }
}

struct InlineStatus: View {
    let text: Text
    let kind: InlineStatusKind

    init(_ key: LocalizedStringKey, kind: InlineStatusKind) {
        text = Text(key)
        self.kind = kind
    }

    init(verbatim: String, kind: InlineStatusKind) {
        text = Text(verbatim: verbatim)
        self.kind = kind
    }

    var body: some View {
        HStack(spacing: 5) {
            if kind == .progress {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: kind.icon)
            }
            text
                .lineLimit(1)
        }
        .font(.caption)
        .foregroundStyle(kind.color)
        .accessibilityElement(children: .combine)
    }
}

struct PermissionRows: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsSection(title: "permissions.title") {
            permissionRow(
                icon: "mic",
                title: "permissions.microphone",
                detail: "permissions.microphone.detail",
                granted: environment.permissions.microphone,
                request: environment.requestMicrophonePermission,
                settings: environment.openMicrophoneSettings
            )
            permissionRow(
                icon: "accessibility",
                title: "permissions.accessibility",
                detail: "permissions.accessibility.detail",
                granted: environment.permissions.accessibility,
                request: environment.requestAccessibilityPermission,
                settings: environment.openAccessibilitySettings,
                showsDivider: false
            )
        }
    }

    private func permissionRow(
        icon: String,
        title: LocalizedStringKey,
        detail: LocalizedStringKey,
        granted: Bool,
        request: @escaping () -> Void,
        settings: @escaping () -> Void,
        showsDivider: Bool = true
    ) -> some View {
        SettingsRow(icon: icon, title: title, detail: detail, showsDivider: showsDivider) {
            HStack(spacing: 8) {
                InlineStatus(
                    granted ? "permissions.granted" : "permissions.required",
                    kind: granted ? .success : .warning
                )
                if !granted {
                    Button("permissions.allow", action: request)
                    Button(action: settings) {
                        Image(systemName: "gearshape")
                    }
                    .help("permissions.openSettings")
                    .accessibilityLabel("permissions.openSettings")
                }
            }
        }
    }
}

struct CredentialEditor: View {
    @EnvironmentObject private var environment: AppEnvironment
    let account: CredentialAccount
    var showsDivider: Bool
    var onSaved: ((Bool) -> Void)?

    @State private var value = ""
    @State private var state = SaveState.idle

    init(
        account: CredentialAccount,
        showsDivider: Bool = false,
        onSaved: ((Bool) -> Void)? = nil
    ) {
        self.account = account
        self.showsDivider = showsDivider
        self.onSaved = onSaved
    }

    var body: some View {
        SettingsRow(icon: "key", title: "speech.apiKey", showsDivider: showsDivider) {
            HStack(spacing: 8) {
                SecureField("speech.apiKey.placeholder", text: $value)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 220)
                Button("common.save") {
                    state = .saving
                    Task {
                        do {
                            try await environment.saveCredential(value, account: account)
                            let configured = !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            state = .saved
                            onSaved?(configured)
                        } catch {
                            state = .failed(error.localizedDescription)
                            onSaved?(false)
                        }
                    }
                }
                .disabled(state == .saving)
                status
            }
        }
        .task(id: account) {
            value = await environment.credential(account)
            state = .idle
            onSaved?(!value.isEmpty)
        }
    }

    @ViewBuilder
    private var status: some View {
        switch state {
        case .idle:
            EmptyView()
        case .saving:
            InlineStatus("common.saving", kind: .progress)
        case .saved:
            InlineStatus("common.saved", kind: .success)
        case .failed(let message):
            InlineStatus(verbatim: message, kind: .error)
                .frame(maxWidth: 150)
                .help(message)
        }
    }

    private enum SaveState: Equatable {
        case idle
        case saving
        case saved
        case failed(String)
    }
}

struct HotkeyRecorder: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Binding var value: String

    @State private var isRecording = false
    @State private var monitor: Any?

    var body: some View {
        Button {
            isRecording ? stopRecording() : startRecording()
        } label: {
            if isRecording {
                Label("hotkey.recording", systemImage: "keyboard.badge.ellipsis")
            } else {
                Text(
                    verbatim: HotkeyCapture.displayName(
                        for: value,
                        language: environment.settings.uiLanguage
                    )
                )
                    .monospaced()
            }
        }
        .frame(minWidth: 132)
        .help(isRecording ? "hotkey.cancelHint" : "hotkey.record")
        .onDisappear { stopRecording() }
    }

    private func startRecording() {
        environment.suspendHotkeysForCapture()
        isRecording = true
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { event in
            if HotkeyCapture.isCancelKeyCode(event.keyCode) {
                stopRecording()
                return nil
            }
            guard let captured = HotkeyCapture.value(from: event) else { return nil }
            value = captured
            stopRecording()
            return nil
        }
    }

    private func stopRecording() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
        if isRecording {
            isRecording = false
            environment.resumeHotkeysAfterCapture()
        }
    }
}

enum HotkeyCapture {
    private static let modifierKeys: [UInt16: String] = [
        54: "RightCommand",
        55: "LeftCommand",
        61: "RightOption",
        58: "LeftOption",
        62: "RightControl",
        59: "LeftControl",
        63: "Fn",
    ]

    static func value(from event: NSEvent) -> String? {
        if event.type == .flagsChanged {
            return modifierKeys[event.keyCode]
        }
        guard event.type == .keyDown else { return nil }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var parts: [String] = []
        if flags.contains(.command) { parts.append("Command") }
        if flags.contains(.option) { parts.append("Option") }
        if flags.contains(.control) { parts.append("Control") }
        if flags.contains(.shift) { parts.append("Shift") }
        guard !parts.isEmpty, let key = keyName(for: event) else { return nil }
        parts.append(key)
        return parts.joined(separator: "+")
    }

    static func displayName(for value: String, language: UILanguage) -> String {
        switch value.lowercased() {
        case "rightcommand", "right command": AppLocalization.string("hotkey.rightCommand", language: language)
        case "leftcommand", "left command": AppLocalization.string("hotkey.leftCommand", language: language)
        case "rightoption", "right option", "rightalt": AppLocalization.string("hotkey.rightOption", language: language)
        case "leftoption", "left option", "leftalt": AppLocalization.string("hotkey.leftOption", language: language)
        case "rightcontrol", "right control": AppLocalization.string("hotkey.rightControl", language: language)
        case "leftcontrol", "left control": AppLocalization.string("hotkey.leftControl", language: language)
        case "fn", "globe": AppLocalization.string("hotkey.globe", language: language)
        default:
            value
                .replacingOccurrences(of: "Command", with: "⌘")
                .replacingOccurrences(of: "Option", with: "⌥")
                .replacingOccurrences(of: "Control", with: "⌃")
                .replacingOccurrences(of: "Shift", with: "⇧")
                .replacingOccurrences(of: "+", with: "")
                .uppercased()
        }
    }

    static func conflicts(_ first: String, _ second: String) -> Bool {
        let lhs = normalized(first)
        let rhs = normalized(second)
        return !lhs.isEmpty && lhs == rhs
    }

    static func isCancelKeyCode(_ keyCode: UInt16) -> Bool {
        keyCode == 53
    }

    private static func normalized(_ value: String) -> String {
        value.lowercased().filter { !$0.isWhitespace }
    }

    private static func keyName(for event: NSEvent) -> String? {
        switch event.keyCode {
        case 49: "Space"
        case 36: "Return"
        case 48: "Tab"
        default:
            event.charactersIgnoringModifiers?.lowercased().first.map(String.init)
        }
    }
}

struct SidebarGlassBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            SidebarVisualEffect()
            LinearGradient(
                colors: [
                    Color.accentColor.opacity(colorScheme == .dark ? 0.07 : 0.035),
                    Color.cyan.opacity(colorScheme == .dark ? 0.025 : 0.015),
                    .clear,
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .ignoresSafeArea()
    }
}

private struct SidebarVisualEffect: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .sidebar
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
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
