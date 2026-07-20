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
        let ownPID = ProcessInfo.processInfo.processIdentifier
        // Mouthpiece frontmost means a real window of ours is key (control panel,
        // prompt-studio test): dictate into our own focused field instead of
        // leaking the transcript into the previously active app.
        let candidate = isExternalApplication(frontmost)
            ? frontmost
            : (frontmost?.processIdentifier == ownPID ? frontmost : lastExternalApplication)
        guard let app = candidate,
              isExternalApplication(app) || app.processIdentifier == ownPID else {
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
            focusedElement = Self.accessibilityElement(from: focusedValue)
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
        guard let application = NSRunningApplication(processIdentifier: target.processIdentifier) else {
            throw TextInsertionError.targetUnavailable
        }
        if settings.sensitiveAppProtectionEnabled,
           settings.sensitiveAppBlockInsertion,
           Self.isSensitive(target) {
            throw TextInsertionError.blockedSensitiveApplication(target.applicationName)
        }
        guard AXIsProcessTrusted() else {
            throw TextInsertionError.accessibilityPermissionDenied
        }

        var directError = await Self.setSelectedText(text, on: target.focusedElement)
        if directError == .success { return }
        if directError == .apiDisabled { throw TextInsertionError.accessibilityPermissionDenied }

        var focusedResult = await Self.currentFocusedElement(processIdentifier: target.processIdentifier)
        directError = await Self.setSelectedText(text, on: focusedResult.element)
        if directError == .success { return }
        if directError == .apiDisabled || focusedResult.error == .apiDisabled {
            throw TextInsertionError.accessibilityPermissionDenied
        }

        if !application.isActive {
            application.activate(options: [.activateIgnoringOtherApps])
            for _ in 0..<10 {
                if NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier {
                    break
                }
                try await Task.sleep(for: .milliseconds(30))
            }
            focusedResult = await Self.currentFocusedElement(processIdentifier: target.processIdentifier)
            directError = await Self.setSelectedText(text, on: focusedResult.element)
            if directError == .success { return }
            if directError == .apiDisabled || focusedResult.error == .apiDisabled {
                throw TextInsertionError.accessibilityPermissionDenied
            }
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier else {
            throw TextInsertionError.targetBusy(target.applicationName)
        }

        do {
            try await paste(text, into: target)
        } catch where directError == .cannotComplete || focusedResult.error == .cannotComplete {
            throw TextInsertionError.targetBusy(target.applicationName)
        }
    }

    private struct AXElementBox: @unchecked Sendable {
        let element: AXUIElement
    }

    private final class ResumeGate: @unchecked Sendable {
        private var claimed = false
        private let lock = NSLock()

        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if claimed { return false }
            claimed = true
            return true
        }
    }

    private struct FocusedResult: @unchecked Sendable {
        let element: AXUIElement?
        let error: AXError
    }

    private nonisolated static func currentFocusedElement(
        processIdentifier: pid_t
    ) async -> (element: AXUIElement?, error: AXError) {
        let appElement = AXElementBox(element: AXUIElementCreateApplication(processIdentifier))
        let result = await raceWithTimeout(.milliseconds(1500)) {
            var focusedValue: CFTypeRef?
            let err = AXUIElementCopyAttributeValue(
                appElement.element,
                kAXFocusedUIElementAttribute as CFString,
                &focusedValue
            )
            return FocusedResult(
                element: Self.accessibilityElement(from: focusedValue),
                error: err
            )
        }
        guard let result else { return (nil, .cannotComplete) }
        return (result.element, result.error)
    }

    private nonisolated static func setSelectedText(
        _ text: String,
        on element: AXUIElement?
    ) async -> AXError {
        guard let element else { return .noValue }
        let box = AXElementBox(element: element)
        return await raceWithTimeout(.seconds(3)) {
            AXUIElementSetAttributeValue(
                box.element,
                kAXSelectedTextAttribute as CFString,
                text as CFTypeRef
            )
        } ?? .cannotComplete
    }

    // AX calls are blocking C APIs that ignore Task cancellation, so race them
    // on unstructured GCD threads and abandon the loser. A withTaskGroup child
    // blocked inside AX would keep the scope (and the caller) waiting on a hung
    // target app, which made the previous 3-second timeout unenforceable.
    private nonisolated static func raceWithTimeout<T: Sendable>(
        _ timeout: DispatchTimeInterval,
        operation: @escaping @Sendable () -> T
    ) async -> T? {
        let gate = ResumeGate()
        return await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let result = operation()
                if gate.claim() { continuation.resume(returning: result) }
            }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) {
                if gate.claim() { continuation.resume(returning: nil) }
            }
        }
    }

    nonisolated static func accessibilityElement(from value: CFTypeRef?) -> AXUIElement? {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    private nonisolated static func postPasteEvents() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                guard let source = CGEventSource(stateID: .hidSystemState),
                      let down = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: true),
                      let up = CGEvent(keyboardEventSource: source, virtualKey: 9, keyDown: false) else {
                    continuation.resume()
                    return
                }
                down.flags = .maskCommand
                up.flags = .maskCommand
                down.post(tap: .cghidEventTap)
                up.post(tap: .cghidEventTap)
                continuation.resume()
            }
        }
    }

    private func paste(_ text: String, into target: TextInsertionTarget) async throws {
        let pasteboard = NSPasteboard.general
        let oldItems = Self.snapshot(of: pasteboard)
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        let insertedChangeCount = pasteboard.changeCount
        defer {
            Self.restore(
                oldItems,
                ifUnchanged: insertedChangeCount,
                expectedText: text,
                pasteboard: pasteboard
            )
        }

        await Self.postPasteEvents()

        try await Task.sleep(for: pasteDelay(for: target))
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
