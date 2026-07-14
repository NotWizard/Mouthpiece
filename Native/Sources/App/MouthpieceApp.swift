import SwiftUI

@main
struct MouthpieceApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var environment = AppEnvironment()

    var body: some Scene {
        WindowGroup("Mouthpiece", id: "control-panel") {
            ControlPanelView()
                .environmentObject(environment)
                .environment(\.locale, locale)
                .preferredColorScheme(colorScheme)
                .frame(minWidth: 760, minHeight: 560)
        }
        .defaultSize(width: 1040, height: 700)
        .windowResizability(.contentMinSize)
        .windowToolbarStyle(.unifiedCompact)

        Settings {
            ControlPanelView()
                .environmentObject(environment)
                .environment(\.locale, locale)
                .preferredColorScheme(colorScheme)
                .frame(minWidth: 760, minHeight: 560)
        }
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
