import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    static var shutdownHandler: (() async -> Void)?

    private var statusItem: NSStatusItem?
    private var settingsObserver: NSObjectProtocol?
    private var language = UILanguage.system
    private var showInMenuBar = true
    private var terminationInFlight = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        settingsObserver = NotificationCenter.default.addObserver(
            forName: .mouthpieceRuntimeSettingsChanged,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            let language = notification.userInfo?["language"] as? String
            let showInMenuBar = notification.userInfo?["showInMenuBar"] as? Bool
            Task { @MainActor in
                self?.applyRuntimeSettings(language: language, showInMenuBar: showInMenuBar)
            }
        }
        installStatusItem()
        NSApp.setActivationPolicy(.regular)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
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
            action: #selector(quit),
            keyEquivalent: "q"
        )
        statusItem.menu = menu
    }

    private func applyRuntimeSettings(language raw: String?, showInMenuBar nextVisibility: Bool?) {
        if let raw,
           let language = UILanguage(rawValue: raw) {
            self.language = language
        }
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
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
