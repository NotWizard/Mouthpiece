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

    func captureTarget() async -> TextInsertionTarget? {
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
        // In-process AX requests short-circuit and run AppKit's accessibility
        // handlers on the calling (background) thread, which is unsafe; the
        // self-target insertion uses the paste path and needs no element.
        if app.processIdentifier == ownPID {
            return TextInsertionTarget(
                processIdentifier: app.processIdentifier,
                bundleIdentifier: app.bundleIdentifier,
                applicationName: app.localizedName ?? app.bundleIdentifier ?? "Unknown App",
                focusedElement: nil
            )
        }
        // Never block the main thread on AX messaging: a hung target app makes
        // the synchronous call spin HIServices exception machinery on this
        // thread, which poisons the Swift concurrency executor state and leads
        // to delayed EXC_BAD_ACCESS crashes in unrelated @MainActor code.
        let focused = await Self.currentFocusedElement(processIdentifier: app.processIdentifier)
        return TextInsertionTarget(
            processIdentifier: app.processIdentifier,
            bundleIdentifier: app.bundleIdentifier,
            applicationName: app.localizedName ?? app.bundleIdentifier ?? "Unknown App",
            focusedElement: focused.element
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

        // In-process AX SetValue runs the AppKit handler (NSTextView/TSM
        // mutation) on the calling background thread and trips the main-queue
        // assertion; paste is delivered through the main event loop instead.
        if target.processIdentifier == ProcessInfo.processInfo.processIdentifier {
            try await paste(text, into: target)
            return
        }

        switch await Self.insertViaAccessibility(text, on: target.focusedElement) {
        case .inserted: return
        case .denied: throw TextInsertionError.accessibilityPermissionDenied
        case .notInserted: break
        }

        var focusedResult = await Self.currentFocusedElement(processIdentifier: target.processIdentifier)
        switch await Self.insertViaAccessibility(text, on: focusedResult.element) {
        case .inserted: return
        case .denied: throw TextInsertionError.accessibilityPermissionDenied
        case .notInserted: break
        }
        if focusedResult.error == .apiDisabled {
            throw TextInsertionError.accessibilityPermissionDenied
        }

        if NSWorkspace.shared.frontmostApplication?.processIdentifier != target.processIdentifier {
            application.activate(options: [.activateIgnoringOtherApps])
            for _ in 0..<20 {
                if NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier {
                    break
                }
                try await Task.sleep(for: .milliseconds(30))
            }
            focusedResult = await Self.currentFocusedElement(processIdentifier: target.processIdentifier)
            switch await Self.insertViaAccessibility(text, on: focusedResult.element) {
            case .inserted: return
            case .denied: throw TextInsertionError.accessibilityPermissionDenied
            case .notInserted: break
            }
        }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == target.processIdentifier else {
            throw TextInsertionError.targetBusy(target.applicationName)
        }

        try await paste(text, into: target)
    }

    private struct AXElementBox: @unchecked Sendable {
        let element: AXUIElement
    }

    private enum AXInsertOutcome: Sendable {
        case inserted
        case denied
        case notInserted
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

    private nonisolated static func insertViaAccessibility(
        _ text: String,
        on element: AXUIElement?
    ) async -> AXInsertOutcome {
        guard let element else { return .notInserted }
        let box = AXElementBox(element: element)
        let outcome = await raceWithTimeout(.seconds(3)) { () -> AXInsertOutcome in
            var roleValue: CFTypeRef?
            let roleError = AXUIElementCopyAttributeValue(
                box.element,
                kAXRoleAttribute as CFString,
                &roleValue
            )
            if roleError == .apiDisabled { return .denied }
            let editableRoles: Set<String> = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole]
            guard let role = roleValue as? String, editableRoles.contains(role) else {
                // GPU terminals (Ghostty/kitty/Alacritty) expose AXGroup/AXUnknown and
                // never truly accept an AX text set, so skip to the paste fallback.
                return .notInserted
            }
            var beforeValue: CFTypeRef?
            AXUIElementCopyAttributeValue(box.element, kAXValueAttribute as CFString, &beforeValue)
            let before = beforeValue as? String
            let setError = AXUIElementSetAttributeValue(
                box.element,
                kAXSelectedTextAttribute as CFString,
                text as CFTypeRef
            )
            if setError == .apiDisabled { return .denied }
            if setError != .success { return .notInserted }
            // Some fields (VS Code, Google Docs, terminals) report .success but do not
            // change; verify the value actually moved before trusting the write.
            var afterValue: CFTypeRef?
            AXUIElementCopyAttributeValue(box.element, kAXValueAttribute as CFString, &afterValue)
            if let before, let after = afterValue as? String, before == after {
                return .notInserted
            }
            return .inserted
        }
        return outcome ?? .notInserted
    }

    // AX calls are blocking C APIs that ignore Task cancellation, so race them
    // on unstructured GCD threads and abandon the loser. A withTaskGroup child
    // blocked inside AX would keep the scope (and the caller) waiting on a hung
    // target app, which made the previous 3-second timeout unenforceable.
    private final class AbandonedBudget: @unchecked Sendable {
        static let shared = AbandonedBudget()
        private let lock = NSLock()
        private var outstanding = 0

        var hasCapacity: Bool {
            lock.lock()
            defer { lock.unlock() }
            // ponytail: fixed cap of 8 abandoned AX threads; raise or make
            // per-target if a legitimate workload ever hits it.
            return outstanding < 8
        }

        func markAbandoned() {
            lock.lock()
            defer { lock.unlock() }
            outstanding += 1
        }

        func markReturned() {
            lock.lock()
            defer { lock.unlock() }
            outstanding -= 1
        }
    }

    private nonisolated static func raceWithTimeout<T: Sendable>(
        _ timeout: DispatchTimeInterval,
        operation: @escaping @Sendable () -> T
    ) async -> T? {
        // Each timeout leaves one GCD thread blocked inside the hung AX call;
        // stop attempting new ones before the pool (~64 threads) drains and
        // let callers fall through to the Cmd+V paste path instead.
        guard AbandonedBudget.shared.hasCapacity else { return nil }
        let gate = ResumeGate()
        return await withCheckedContinuation { (continuation: CheckedContinuation<T?, Never>) in
            DispatchQueue.global(qos: .userInitiated).async {
                let result = operation()
                if gate.claim() {
                    continuation.resume(returning: result)
                } else {
                    AbandonedBudget.shared.markReturned()
                }
            }
            DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + timeout) {
                if gate.claim() {
                    AbandonedBudget.shared.markAbandoned()
                    continuation.resume(returning: nil)
                }
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

    private struct PendingRestore {
        let items: [[NSPasteboard.PasteboardType: Data]]
        let changeCount: Int
        let text: String
        let task: Task<Void, Never>
    }

    private var pendingRestore: PendingRestore?

    private func paste(_ text: String, into target: TextInsertionTarget) async throws {
        let pasteboard = NSPasteboard.general
        let oldItems: [[NSPasteboard.PasteboardType: Data]]
        if let pending = pendingRestore {
            // A second dictation within the restore delay would otherwise
            // snapshot our own previous transcript and later "restore" it over
            // the user's real clipboard. Take over the original snapshot the
            // cancelled restore was still holding.
            pending.task.cancel()
            pendingRestore = nil
            oldItems = Self.snapshotForNewPaste(
                pendingItems: pending.items,
                pendingChangeCount: pending.changeCount,
                pendingText: pending.text,
                pasteboard: pasteboard
            )
        } else {
            oldItems = Self.snapshot(of: pasteboard)
        }
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        let insertedChangeCount = pasteboard.changeCount

        await Self.postPasteEvents()

        // Restore the original clipboard only after giving the target time to
        // consume it. Some apps (Electron, browsers, busy apps) read the
        // pasteboard asynchronously, so restoring inside a quick defer clobbered
        // the text before they pasted it. The delayed restore no-ops if the user
        // copied something new in the meantime. Register it BEFORE the
        // cancellable pacing sleep below: the paste events are already posted,
        // so a cancelled session must still restore the user's clipboard.
        let delay = pasteDelay(for: target)
        let task = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay + .milliseconds(900))
            guard !Task.isCancelled else { return }
            Self.restore(
                oldItems,
                ifUnchanged: insertedChangeCount,
                expectedText: text,
                pasteboard: pasteboard
            )
            self?.pendingRestore = nil
        }
        pendingRestore = PendingRestore(
            items: oldItems,
            changeCount: insertedChangeCount,
            text: text,
            task: task
        )
        try await Task.sleep(for: delay)
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

    // If the pasteboard still holds our previous dictation text, the user's
    // real clipboard is the snapshot the cancelled restore was holding; if the
    // user copied something new since, snapshot the live pasteboard instead.
    static func snapshotForNewPaste(
        pendingItems: [[NSPasteboard.PasteboardType: Data]],
        pendingChangeCount: Int,
        pendingText: String,
        pasteboard: NSPasteboard
    ) -> [[NSPasteboard.PasteboardType: Data]] {
        if pasteboard.changeCount == pendingChangeCount,
           pasteboard.string(forType: .string) == pendingText {
            return pendingItems
        }
        return snapshot(of: pasteboard)
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
