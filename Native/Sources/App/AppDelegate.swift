import AppKit
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shutdownHandler: (() async -> Void)?

    private var statusItem: NSStatusItem?
    private var settingsObserver: NSObjectProtocol?
    private var language = UILanguage.system
    private var showInMenuBar = true
    private var showInDock = true
    private var terminationInFlight = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // A swallowed ObjC exception unwinding through Swift concurrency frames
        // corrupts the main thread's executor state and crashes later in
        // unrelated @MainActor code; fail fast at the true source instead.
        UserDefaults.standard.register(defaults: ["NSApplicationCrashOnExceptions": true])
        settingsObserver = NotificationCenter.default.addObserver(
            forName: .mouthpieceRuntimeSettingsChanged,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let language = notification.userInfo?["language"] as? String
            let showInMenuBar = notification.userInfo?["showInMenuBar"] as? Bool
            let showInDock = notification.userInfo?["showInDock"] as? Bool
            Task { @MainActor in
                self?.applyRuntimeSettings(
                    language: language,
                    showInMenuBar: showInMenuBar,
                    showInDock: showInDock
                )
            }
        }
        installStatusItem()
        NSApp.setActivationPolicy(.regular)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    /// Intercept the dock-reopen (kAEOpenApplication) Apple event.
    /// Returning true (handled) prevents SwiftUI's AppWindowsController.showInitialWindows
    /// from rebuilding an NSHostingView for the WindowGroup, which on this app dereferences a
    /// corrupted/poisoned @MainActor executor (EXC_BAD_ACCESS at 0xaaaaaaaaaaaaaad0) during
    /// NSHostingView.viewDidMoveToWindow -> LazyView.body.getter -> swift_task_isCurrentExecutorWithFlagsImpl.
    /// Instead, re-show the existing control-panel window (or the Settings window) without
    /// tearing down and recreating the hosting view.
    func applicationOpenUntitledFile(_ sender: NSApplication) -> Bool {
        showControlPanel()
        return true
    }

    /// Opening an already-running app again (Spotlight, Finder, Launchpad, `open`)
    /// sends kAEReopenApplication, not kAEOpenApplication, so the handler above never
    /// runs for it. AppKit resets the activation policy to the Info.plist-declared
    /// regular type while processing that event, which put the Dock icon back for good
    /// even with "Show in Dock" off. Restore the user's choice here and let AppKit
    /// re-show the window as it always has.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !showInDock { NSApp.setActivationPolicy(.accessory) }
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard !terminationInFlight, let shutdownHandler = Self.shutdownHandler else {
            return terminationInFlight ? .terminateLater : .terminateNow
        }
        terminationInFlight = true
        Task { @MainActor in
            await shutdownHandler()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let settingsObserver { NotificationCenter.default.removeObserver(settingsObserver) }
        Self.shutdownHandler = nil
        statusItem = nil
    }

    private func installStatusItem() {
        guard showInMenuBar else {
            statusItem = nil
            return
        }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        item.button?.image = MouthpieceBrandMark.compactImage
            ?? NSImage(systemSymbolName: "waveform", accessibilityDescription: "Mouthpiece")
        item.button?.image?.accessibilityDescription = "Mouthpiece"
        item.button?.imageScaling = .scaleProportionallyDown

        statusItem = item
        rebuildMenu()
    }

    private func rebuildMenu() {
        guard let statusItem else { return }
        let menu = NSMenu()
        menu.addItem(
            withTitle: AppLocalization.string("menu.toggleDictation", language: language),
            action: #selector(toggleDictation),
            keyEquivalent: ""
        )
        menu.addItem(.separator())
        menu.addItem(
            withTitle: AppLocalization.string("menu.openControlPanel", language: language),
            action: #selector(openControlPanel),
            keyEquivalent: ","
        )
        menu.addItem(.separator())
        menu.addItem(
            withTitle: AppLocalization.string("menu.quit", language: language),
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        )
        statusItem.menu = menu
    }

    private func applyRuntimeSettings(
        language raw: String?,
        showInMenuBar nextVisibility: Bool?,
        showInDock nextDockVisibility: Bool?
    ) {
        if let raw,
           let language = UILanguage(rawValue: raw) {
            self.language = language
        }
        if let nextDockVisibility { showInDock = nextDockVisibility }
        let visibility = nextVisibility ?? showInMenuBar
        if visibility != showInMenuBar {
            showInMenuBar = visibility
            installStatusItem()
        } else {
            rebuildMenu()
        }
    }

    @objc private func toggleDictation() {
        NotificationCenter.default.post(name: .mouthpieceToggleDictation, object: nil)
    }

    @objc private func openControlPanel() {
        showControlPanel()
    }

    private func showControlPanel() {
        NSApp.activate(ignoringOtherApps: true)
        if let open = ControlPanelWindowAccess.open {
            open(id: ControlPanelWindowAccess.id)
            return
        }
        // Fallback if the openWindow action was never captured yet.
        if let window = NSApp.windows.first(where: { $0.canBecomeMain && $0.isVisible })
            ?? NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }
}
