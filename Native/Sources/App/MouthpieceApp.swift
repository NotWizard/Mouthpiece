import SwiftUI

@MainActor
enum ControlPanelWindowAccess {
    static let id = "control-panel"
    static var open: OpenWindowAction?
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
