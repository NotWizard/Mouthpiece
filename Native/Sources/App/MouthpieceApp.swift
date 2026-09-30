import SwiftUI

@MainActor
enum ControlPanelWindowAccess {
    static let id = "control-panel"
    static var open: OpenWindowAction?

    /// Opens (or surfaces) the control panel and guarantees it lands in FRONT
    /// of the previously focused app. SwiftUI materializes the NSWindow on a
    /// later runloop pass after `open` is invoked, so an activate-then-open
    /// sequence loses the layering race and the panel surfaces behind the
    /// caller's app (Spotlight/dock reopen, hotkeys). The immediate +
    /// delayed re-assertion covers both the fast path and slow window
    /// materialization; `orderFrontRegardless` also covers the
    /// Show-in-Dock-off accessory policy where plain ordering can stay
    /// layered below the active app.
    static func present() {
        if let open {
            open(id: id)
        } else if let window = NSApp.windows.first(where: { $0.canBecomeMain && $0.isVisible })
            ?? NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
        }
        Task { @MainActor in
            assertFrontmost()
            try? await Task.sleep(for: .milliseconds(60))
            assertFrontmost()
        }
    }

    private static func assertFrontmost() {
        NSApp.activate(ignoringOtherApps: true)
        if let window = NSApp.windows.first(where: { $0.canBecomeMain }) {
            window.makeKeyAndOrderFront(nil)
            window.orderFrontRegardless()
        }
    }
}

@main
struct MouthpieceApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var environment = AppEnvironment()

    var body: some Scene {
        Window("Mouthpiece", id: ControlPanelWindowAccess.id) {
            ControlPanelView()
                .environmentObject(environment)
                .environment(\.locale, locale)
                .preferredColorScheme(colorScheme)
                .frame(
                    minWidth: environment.settings.onboardingCompleted
                        ? ControlPanelWindowMetrics.minimumContentSize.width : 760,
                    minHeight: environment.settings.onboardingCompleted
                        ? ControlPanelWindowMetrics.minimumContentSize.height : 560
                )
        }
        .defaultSize(width: 1040, height: 700)
        .windowResizability(.contentMinSize)
        .windowToolbarStyle(.unifiedCompact)
    }

    private var locale: Locale {
        switch environment.settings.uiLanguage {
        case .simplifiedChinese: Locale(identifier: "zh-Hans")
        case .traditionalChinese: Locale(identifier: "zh-Hant")
        case .english: Locale(identifier: "en")
        case .system: .current
        }
    }

    private var colorScheme: ColorScheme? {
        switch environment.settings.theme {
        case .light: .light
        case .dark: .dark
        case .system: nil
        }
    }
}
