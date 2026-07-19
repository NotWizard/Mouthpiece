import AppKit
import SwiftUI

enum SettingsControlMetrics {
    static let configurationFieldWidth: CGFloat = 280
}

struct SettingsPage<Content: View>: View {
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey
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
            .frame(maxWidth: .infinity, alignment: .leading)
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
    @Environment(\.colorScheme) private var colorScheme

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
            .background(sectionFill)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(sectionBorder, lineWidth: 0.5)
            }
        }
    }

    private var sectionFill: Color {
        colorScheme == .dark ? Color.white.opacity(0.055) : Color.black.opacity(0.04)
    }

    private var sectionBorder: Color {
        colorScheme == .dark ? Color.white.opacity(0.09) : Color.black.opacity(0.075)
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
                .frame(minWidth: 320, alignment: .trailing)
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

struct ProviderChoice: Identifiable, Sendable {
    let id: String
    let title: String
    let assetName: String?
    var assetExtension = "svg"
    let fallbackIcon: String
    var rendersAsTemplate = true
}

struct ProviderSelectionGrid: View {
    @Environment(\.colorScheme) private var colorScheme

    let title: LocalizedStringKey
    let providers: [ProviderChoice]
    let selectedID: String
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .padding(.leading, 2)
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 150), spacing: 8)],
                spacing: 8
            ) {
                ForEach(providers) { provider in
                    Button { onSelect(provider.id) } label: {
                        HStack(spacing: 9) {
                            ProviderIcon(provider: provider)
                            Text(LocalizedStringKey(provider.title))
                                .lineLimit(1)
                            Spacer(minLength: 4)
                            if selectedID == provider.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.tint)
                            }
                        }
                        .padding(.horizontal, 12)
                        .frame(maxWidth: .infinity, minHeight: 46)
                        .background(
                            selectedID == provider.id
                                ? Color.accentColor.opacity(0.12)
                                : providerFill
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(
                                    selectedID == provider.id
                                        ? Color.accentColor.opacity(0.75)
                                        : providerBorder,
                                    lineWidth: selectedID == provider.id ? 1.5 : 0.5
                                )
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selectedID == provider.id ? .isSelected : [])
                }
            }
        }
    }

    private var providerFill: Color {
        colorScheme == .dark ? Color.white.opacity(0.055) : Color.black.opacity(0.04)
    }

    private var providerBorder: Color {
        colorScheme == .dark ? Color.white.opacity(0.09) : Color.black.opacity(0.075)
    }
}

enum MouthpieceBrandMark {
    static let image: NSImage? = {
        guard let url = Bundle.main.url(forResource: "mouthpiece-mark", withExtension: "svg"),
              let image = NSImage(contentsOf: url) else {
            return nil
        }
        image.isTemplate = true
        return image
    }()
}

struct MouthpieceBrandIcon: View {
    var size: CGFloat = 18

    var body: some View {
        if let image = MouthpieceBrandMark.image {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            Image(systemName: "waveform")
                .frame(width: size, height: size)
        }
    }
}

private struct ProviderIcon: View {
    let provider: ProviderChoice

    var body: some View {
        if let assetName = provider.assetName,
           let url = Bundle.main.url(forResource: assetName, withExtension: provider.assetExtension),
           let image = NSImage(contentsOf: url) {
            let _ = image.isTemplate = provider.rendersAsTemplate
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
                .frame(width: 18, height: 18)
        } else {
            Image(systemName: provider.fallbackIcon)
                .foregroundStyle(.secondary)
                .frame(width: 18)
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
    @State private var savedValue = ""
    @State private var state = SaveState.idle
    @State private var revealsValue = false
    @State private var saveTask: Task<Void, Never>?
    @State private var saveTaskAccount: CredentialAccount?

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
                HStack(spacing: 4) {
                    Group {
                        if revealsValue {
                            TextField("speech.apiKey.placeholder", text: $value)
                        } else {
                            SecureField("speech.apiKey.placeholder", text: $value)
                        }
                    }
                    .textFieldStyle(.plain)

                    Button {
                        revealsValue.toggle()
                    } label: {
                        Image(systemName: revealsValue ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.plain)
                    .frame(width: 24, height: 20)
                    .help(revealsValue ? "credential.hide" : "credential.show")
                    .accessibilityLabel(revealsValue ? "credential.hide" : "credential.show")
                }
                .padding(.leading, 7)
                .padding(.trailing, 3)
                .frame(width: SettingsControlMetrics.configurationFieldWidth, height: 22)
                .background {
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(Color(nsColor: .controlBackgroundColor))
                        .overlay {
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .stroke(Color(nsColor: .separatorColor).opacity(0.55), lineWidth: 0.5)
                        }
                }
                status
            }
        }
        .task(id: account) {
            let targetAccount = account
            let valueBeforeLoad = value
            revealsValue = false
            do {
                let credential = try await environment.credential(targetAccount)
                try Task.checkCancellation()
                guard Self.shouldApplyLoadedCredential(
                    targetAccount: targetAccount,
                    currentAccount: account,
                    valueBeforeLoad: valueBeforeLoad,
                    currentValue: value
                ) else { return }
                value = credential
                savedValue = credential
                state = .idle
                onSaved?(!credential.isEmpty)
            } catch is CancellationError {
                return
            } catch {
                state = .failed(error.localizedDescription)
                onSaved?(false)
            }
        }
        .onChange(of: value) { _, newValue in
            scheduleSave(newValue)
        }
        .onDisappear {
            guard value != savedValue else { return }
            saveTask?.cancel()
            let pendingValue = value
            let pendingAccount = account
            Task {
                do {
                    try await environment.saveCredential(pendingValue, account: pendingAccount)
                } catch {
                    environment.report(error)
                }
            }
        }
    }

    nonisolated static func shouldApplyLoadedCredential(
        targetAccount: CredentialAccount,
        currentAccount: CredentialAccount,
        valueBeforeLoad: String,
        currentValue: String
    ) -> Bool {
        targetAccount == currentAccount && valueBeforeLoad == currentValue
    }

    private func scheduleSave(_ newValue: String) {
        guard newValue != savedValue else { return }
        if saveTaskAccount == account {
            saveTask?.cancel()
        }
        state = .saving
        let targetAccount = account
        saveTaskAccount = targetAccount
        saveTask = Task {
            do {
                try await Task.sleep(for: .milliseconds(500))
                try Task.checkCancellation()
                try await environment.saveCredential(newValue, account: targetAccount)
                guard account == targetAccount else { return }
                savedValue = newValue
                state = .saved
                onSaved?(!newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } catch is CancellationError {
                return
            } catch {
                state = .failed(error.localizedDescription)
                onSaved?(false)
            }
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

    @State private var isCapturePresented = false

    private static let recordAction = "__record_hotkey__"
    private static let presetValues = [
        "RightCommand",
        "RightShift",
        "RightOption",
        "RightControl",
        "Fn",
    ]

    var body: some View {
        Picker("", selection: selection) {
            if !Self.presetValues.contains(value) {
                Text(verbatim: displayName).tag(value)
            }
            Text("hotkey.rightCommand").tag("RightCommand")
            Text("hotkey.rightShift").tag("RightShift")
            Text("hotkey.rightOption").tag("RightOption")
            Text("hotkey.rightControl").tag("RightControl")
            Text("hotkey.globe").tag("Fn")
            Text("hotkey.record").tag(Self.recordAction)
        }
        .labelsHidden()
        .frame(width: 180, alignment: .trailing)
        .sheet(isPresented: $isCapturePresented) {
            HotkeyCaptureSheet { value = $0 }
                .environmentObject(environment)
        }
    }

    private var displayName: String {
        HotkeyCapture.displayName(
            for: value,
            language: environment.settings.uiLanguage
        )
    }

    private var selection: Binding<String> {
        Binding(
            get: { value },
            set: { newValue in
                if newValue == Self.recordAction {
                    isCapturePresented = true
                } else {
                    value = newValue
                }
            }
        )
    }
}

struct TranslationHotkeyRecorder: View {
    @EnvironmentObject private var environment: AppEnvironment
    @Binding var suffix: String

    @State private var isCapturePresented = false

    private static let recordAction = "__record_translation_suffix__"
    private static let presetValues = [",", ".", "/", ";", "Space"]

    var body: some View {
        HStack(spacing: 7) {
            Text(
                verbatim: HotkeyCapture.displayName(
                    for: environment.settings.dictationKey,
                    language: environment.settings.uiLanguage
                )
            )
            .lineLimit(1)
            Text(verbatim: "+")
                .foregroundStyle(.secondary)
            Picker("", selection: selection) {
                if !Self.presetValues.contains(suffix) {
                    Text(verbatim: suffix.uppercased()).tag(suffix)
                }
                Text("hotkey.suffix.comma").tag(",")
                Text("hotkey.suffix.period").tag(".")
                Text("hotkey.suffix.slash").tag("/")
                Text("hotkey.suffix.semicolon").tag(";")
                Text("hotkey.suffix.space").tag("Space")
                Text("hotkey.record").tag(Self.recordAction)
            }
            .labelsHidden()
            .frame(width: 120, alignment: .trailing)
        }
        .sheet(isPresented: $isCapturePresented) {
            HotkeyCaptureSheet { captured in
                if let capturedSuffix = TranslationHotkey.suffix(from: captured) {
                    suffix = capturedSuffix
                }
            }
            .environmentObject(environment)
        }
    }

    private var selection: Binding<String> {
        Binding(
            get: { suffix },
            set: { newValue in
                if newValue == Self.recordAction {
                    isCapturePresented = true
                } else {
                    suffix = newValue
                }
            }
        )
    }
}

struct HotkeyCaptureSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environment: AppEnvironment

    let onConfirm: (String) -> Void

    @State private var capturedValue: String?
    @State private var monitor: Any?
    @State private var suspendedHotkeys = false

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "keyboard.badge.ellipsis")
                .font(.system(size: 32))
                .foregroundStyle(.tint)

            VStack(spacing: 6) {
                Text("hotkey.capture.title")
                    .font(.title3.weight(.semibold))
                Text("hotkey.capture.subtitle")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            ZStack {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(Color(nsColor: .controlBackgroundColor))
                if let capturedValue {
                    Text(
                        verbatim: HotkeyCapture.displayName(
                            for: capturedValue,
                            language: environment.settings.uiLanguage
                        )
                    )
                    .font(.title3.monospaced().weight(.medium))
                } else {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("hotkey.capture.waiting")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(height: 72)

            HStack {
                Button("common.cancel", role: .cancel) { dismiss() }
                    .keyboardShortcut(.cancelAction)
                Spacer()
                if capturedValue != nil {
                    Button("hotkey.capture.again", action: startListening)
                }
                Button("common.done") {
                    guard let capturedValue else { return }
                    onConfirm(capturedValue)
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                .disabled(capturedValue == nil)
            }
        }
        .padding(28)
        .frame(width: 440)
        .onAppear {
            environment.suspendHotkeysForCapture()
            suspendedHotkeys = true
            startListening()
        }
        .onDisappear {
            stopListening()
            if suspendedHotkeys {
                environment.resumeHotkeysAfterCapture()
            }
        }
    }

    private func startListening() {
        stopListening()
        capturedValue = nil
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .flagsChanged]) { event in
            if HotkeyCapture.isCancelKeyCode(event.keyCode) {
                dismiss()
                return nil
            }
            guard let captured = HotkeyCapture.value(from: event) else { return nil }
            capturedValue = captured
            if HotkeyCapture.completesCapture(for: event.type) {
                stopListening()
            }
            return nil
        }
    }

    private func stopListening() {
        if let monitor {
            NSEvent.removeMonitor(monitor)
            self.monitor = nil
        }
    }
}

enum HotkeyCapture {
    private static let modifierKeys: [UInt16: String] = [
        54: "RightCommand",
        55: "LeftCommand",
        56: "LeftShift",
        60: "RightShift",
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
        guard let key = keyName(for: event) else { return nil }
        parts.append(key)
        return parts.joined(separator: "+")
    }

    static func displayName(for value: String, language: UILanguage) -> String {
        switch value.lowercased() {
        case "rightcommand", "right command": AppLocalization.string("hotkey.rightCommand", language: language)
        case "leftcommand", "left command": AppLocalization.string("hotkey.leftCommand", language: language)
        case "rightshift", "right shift": AppLocalization.string("hotkey.rightShift", language: language)
        case "leftshift", "left shift": AppLocalization.string("hotkey.leftShift", language: language)
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

    static func completesCapture(for eventType: NSEvent.EventType) -> Bool {
        eventType == .keyDown
    }

    private static func normalized(_ value: String) -> String {
        value.lowercased().filter { !$0.isWhitespace }
    }

    private static func keyName(for event: NSEvent) -> String? {
        switch event.keyCode {
        case 49: "Space"
        case 36: "Return"
        case 48: "Tab"
        case 51: "Delete"
        case 117: "ForwardDelete"
        case 115: "Home"
        case 119: "End"
        case 116: "PageUp"
        case 121: "PageDown"
        case 123: "Left"
        case 124: "Right"
        case 125: "Down"
        case 126: "Up"
        case 122: "F1"
        case 120: "F2"
        case 99: "F3"
        case 118: "F4"
        case 96: "F5"
        case 97: "F6"
        case 98: "F7"
        case 100: "F8"
        case 101: "F9"
        case 109: "F10"
        case 103: "F11"
        case 111: "F12"
        default:
            event.charactersIgnoringModifiers?.lowercased().first.map(String.init)
        }
    }
}

struct SidebarGlassBackground: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            Color(nsColor: .windowBackgroundColor)
            SidebarVisualEffect()
            Color(nsColor: .windowBackgroundColor)
                .opacity(colorScheme == .dark ? 0.68 : 0.72)
            LinearGradient(
                colors: [
                    Color.accentColor.opacity(colorScheme == .dark ? 0.025 : 0.055),
                    Color.cyan.opacity(colorScheme == .dark ? 0.012 : 0.028),
                    .clear,
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Color.white.opacity(colorScheme == .dark ? 0.05 : 0.45))
                .frame(height: 0.5)
        }
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(Color.primary.opacity(colorScheme == .dark ? 0.1 : 0.06))
                .frame(width: 0.5)
        }
        .ignoresSafeArea()
    }
}

private struct SidebarVisualEffect: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .sidebar
        view.blendingMode = .withinWindow
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

struct DeferredSettingTextField: View {
    @EnvironmentObject private var environment: AppEnvironment
    @FocusState private var isFocused: Bool

    private let placeholder: String
    private let keyPath: WritableKeyPath<AppSettings, String>
    private let width: CGFloat
    @State private var draft: String

    init(
        _ placeholder: String,
        value: String,
        keyPath: WritableKeyPath<AppSettings, String>,
        width: CGFloat
    ) {
        self.placeholder = placeholder
        self.keyPath = keyPath
        self.width = width
        _draft = State(initialValue: value)
    }

    var body: some View {
        TextField(placeholder, text: $draft)
            .textFieldStyle(.roundedBorder)
            .frame(width: width)
            .focused($isFocused)
            .onSubmit(commit)
            .onChange(of: isFocused) { wasFocused, focused in
                if wasFocused && !focused { commit() }
            }
            .onChange(of: environment.settings[keyPath: keyPath]) { _, value in
                if !isFocused { draft = value }
            }
            .onDisappear(perform: commit)
    }

    private func commit() {
        let savedValue = environment.settings[keyPath: keyPath]
        guard draft != savedValue else { return }
        var settings = environment.settings
        settings[keyPath: keyPath] = draft
        environment.saveSettings(settings)
        draft = environment.settings[keyPath: keyPath]
    }
}
