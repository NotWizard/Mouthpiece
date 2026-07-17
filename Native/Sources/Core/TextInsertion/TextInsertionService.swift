import AppKit
import ApplicationServices

struct TextInsertionTarget: Equatable, @unchecked Sendable {
    let processIdentifier: pid_t
    let bundleIdentifier: String?
    let applicationName: String
    let focusedElement: AXUIElement?

    init(
        processIdentifier: pid_t,
        bundleIdentifier: String?,
        applicationName: String,
        focusedElement: AXUIElement? = nil
    ) {
        self.processIdentifier = processIdentifier
        self.bundleIdentifier = bundleIdentifier
        self.applicationName = applicationName
        self.focusedElement = focusedElement
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.processIdentifier == rhs.processIdentifier
            && lhs.bundleIdentifier == rhs.bundleIdentifier
            && lhs.applicationName == rhs.applicationName
    }
}

enum TextInsertionError: LocalizedError {
    case targetUnavailable
    case blockedSensitiveApplication(String)
    case accessibilityPermissionDenied
    case targetBusy(String)
    case insertionFailed(AXError)

    var errorDescription: String? {
        switch self {
        case .targetUnavailable: "The application that started dictation is no longer available."
        case .blockedSensitiveApplication(let name): "Text insertion is disabled for \(name)."
        case .accessibilityPermissionDenied: "Accessibility permission is required to insert text."
        case .targetBusy(let name): "\(name) is busy and could not accept text. Try again."
        case .insertionFailed(let error): "Text insertion failed with Accessibility error \(error.rawValue)."
        }
    }
}

@MainActor
final class TextInsertionService {
    private var lastExternalApplication: NSRunningApplication?
    private nonisolated(unsafe) var activationObserver: NSObjectProtocol?

    init() {
        rememberExternalApplication(NSWorkspace.shared.frontmostApplication)
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey]
                as? NSRunningApplication else { return }
            Task { @MainActor in self?.rememberExternalApplication(application) }
        }
    }

    deinit {
        if let activationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(activationObserver)
        }
    }

    func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }

    func captureTarget() -> TextInsertionTarget? {
        let frontmost = NSWorkspace.shared.frontmostApplication
        if isExternalApplication(frontmost) { rememberExternalApplication(frontmost) }
        let candidate = isExternalApplication(frontmost) ? frontmost : lastExternalApplication
        guard let app = candidate, isExternalApplication(app) else {
            return nil
        }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        var focusedValue: CFTypeRef?
        let focusedElement: AXUIElement?
        if AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedValue
        ) == .success, let focusedValue {
            focusedElement = (focusedValue as! AXUIElement)
        } else {
            focusedElement = nil
        }
        return TextInsertionTarget(
            processIdentifier: app.processIdentifier,
            bundleIdentifier: app.bundleIdentifier,
            applicationName: app.localizedName ?? app.bundleIdentifier ?? "Unknown App",
            focusedElement: focusedElement
        )
    }

    private func rememberExternalApplication(_ application: NSRunningApplication?) {
        guard isExternalApplication(application) else { return }
        lastExternalApplication = application
    }

    private func isExternalApplication(_ application: NSRunningApplication?) -> Bool {
        guard let application else { return false }
        return Self.isExternalApplication(
            processIdentifier: application.processIdentifier,
            bundleIdentifier: application.bundleIdentifier,
            currentProcessIdentifier: ProcessInfo.processInfo.processIdentifier,
            currentBundleIdentifier: Bundle.main.bundleIdentifier,
            isTerminated: application.isTerminated
        )
    }

    nonisolated static func isExternalApplication(
        processIdentifier: pid_t,
        bundleIdentifier: String?,
        currentProcessIdentifier: pid_t,
        currentBundleIdentifier: String?,
        isTerminated: Bool
    ) -> Bool {
        guard !isTerminated, processIdentifier != currentProcessIdentifier else { return false }
        guard let currentBundleIdentifier else { return true }
        return bundleIdentifier != currentBundleIdentifier
    }

    func insert(
        _ text: String,
        into target: TextInsertionTarget,
        settings: AppSettings
    ) async throws {
        guard NSRunningApplication(processIdentifier: target.processIdentifier) != nil else {
            throw TextInsertionError.targetUnavailable
        }
        if settings.sensitiveAppProtectionEnabled,
           settings.sensitiveAppBlockInsertion,
           Self.isSensitive(target) {
            throw TextInsertionError.blockedSensitiveApplication(target.applicationName)
        }
        let focusedResult = focusedElement(for: target)
        if focusedResult.error == .apiDisabled {
            throw TextInsertionError.accessibilityPermissionDenied
        }
        if let focused = focusedResult.element {
            let directError = AXUIElementSetAttributeValue(
                focused,
                kAXSelectedTextAttribute as CFString,
                text as CFTypeRef
            )
            if directError == .success { return }
            if directError == .apiDisabled { throw TextInsertionError.accessibilityPermissionDenied }
        }
        do {
            try await paste(text, into: target)
        } catch where focusedResult.error == .cannotComplete {
            throw TextInsertionError.targetBusy(target.applicationName)
        }
    }

    private func focusedElement(for target: TextInsertionTarget) -> (element: AXUIElement?, error: AXError) {
        if let focusedElement = target.focusedElement { return (focusedElement, .success) }
        let appElement = AXUIElementCreateApplication(target.processIdentifier)
        var focusedValue: CFTypeRef?
        let error = AXUIElementCopyAttributeValue(
            appElement,
            kAXFocusedUIElementAttribute as CFString,
            &focusedValue
        )
        return (focusedValue.map { $0 as! AXUIElement }, error)
    }

    private func paste(_ text: String, into target: TextInsertionTarget) async throws {
        let pasteboard = NSPasteboard.general
        let oldItems = Self.snapshot(of: pasteboard)
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        let insertedChangeCount = pasteboard.changeCount

        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else {
            Self.restore(oldItems, ifUnchanged: insertedChangeCount, expectedText: text, pasteboard: pasteboard)
            throw TextInsertionError.insertionFailed(.failure)
        }
        down.flags = .maskCommand
        up.flags = .maskCommand
        down.postToPid(target.processIdentifier)
        up.postToPid(target.processIdentifier)

        try await Task.sleep(for: pasteDelay(for: target))
        Self.restore(oldItems, ifUnchanged: insertedChangeCount, expectedText: text, pasteboard: pasteboard)
    }

    static func snapshot(of pasteboard: NSPasteboard) -> [[NSPasteboard.PasteboardType: Data]] {
        pasteboard.pasteboardItems?.compactMap { item -> [NSPasteboard.PasteboardType: Data]? in
            var values: [NSPasteboard.PasteboardType: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { values[type] = data }
            }
            return values.isEmpty ? nil : values
        } ?? []
    }

    static func restore(
        _ oldItems: [[NSPasteboard.PasteboardType: Data]],
        ifUnchanged changeCount: Int,
        expectedText: String,
        pasteboard: NSPasteboard
    ) {
        guard pasteboard.changeCount == changeCount,
              pasteboard.string(forType: .string) == expectedText else { return }
        pasteboard.clearContents()
        guard !oldItems.isEmpty else { return }
        let restored = oldItems.map { values -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (type, data) in values { item.setData(data, forType: type) }
            return item
        }
        pasteboard.writeObjects(restored)
    }

    private func pasteDelay(for target: TextInsertionTarget) -> Duration {
        let bundle = target.bundleIdentifier?.lowercased() ?? ""
        if bundle.contains("terminal") || bundle.contains("iterm") { return .milliseconds(90) }
        if bundle.contains("electron") || bundle.contains("chrome") || bundle.contains("code") {
            return .milliseconds(220)
        }
        return .milliseconds(180)
    }

    nonisolated static func isSensitive(_ target: TextInsertionTarget) -> Bool {
        let bundleID = target.bundleIdentifier?.lowercased() ?? ""
        let name = target.applicationName.lowercased()
        let sensitiveTokens = [
            "1password", "bitwarden", "keepass", "keychain", "password",
            "wallet", "bank", "authenticator",
        ]
        return sensitiveTokens.contains { bundleID.contains($0) || name.contains($0) }
    }
}
