import AppKit
import SwiftUI

enum ControlPanelWindowMetrics {
    static let minimumContentSize = NSSize(width: 1000, height: 600)
    static let minimumWindowSize = NSSize(width: 1000, height: 640)
    static let defaultContentSize = NSSize(width: 1040, height: 700)
}

enum ControlPanelSection: String, CaseIterable, Identifiable {
    case usage
    case dictation
    case processing
    case vocabulary
    case history
    case privacy

    var id: String { rawValue }

    static func resolve(_ value: String) -> ControlPanelSection {
        ControlPanelSection(rawValue: value) ?? .usage
    }

    var title: LocalizedStringKey {
        switch self {
        case .usage: "sidebar.general"
        case .dictation: "sidebar.speechRecognition"
        case .processing: "sidebar.textProcessing"
        case .vocabulary: "sidebar.personalization"
        case .history: "sidebar.history"
        case .privacy: "sidebar.privacy"
        }
    }

    var icon: String {
        switch self {
        case .usage: "switch.2"
        case .dictation: "waveform"
        case .processing: "wand.and.stars"
        case .vocabulary: "text.book.closed"
        case .history: "clock"
        case .privacy: "hand.raised"
        }
    }
}

struct ControlPanelView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @AppStorage("controlPanel.selectedSection") private var storedSelection = ControlPanelSection.usage.rawValue

    var body: some View {
        Group {
            if !environment.isReady {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !environment.settings.onboardingCompleted {
                OnboardingView()
            } else {
                NavigationSplitView {
                    sidebar
                } detail: {
                    detail(for: selectedSection)
                }
                .navigationSplitViewStyle(.balanced)
                .frame(
                    minWidth: ControlPanelWindowMetrics.minimumContentSize.width,
                    minHeight: ControlPanelWindowMetrics.minimumContentSize.height
                )
                .background(ControlPanelWindowConfiguration())
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .alert(
            AppLocalization.string("common.error", language: environment.settings.uiLanguage),
            isPresented: Binding(
                get: { environment.settings.onboardingCompleted && environment.startupError != nil },
                set: { presented in if !presented { environment.dismissStartupError() } }
            )
        ) {
            Button("common.ok") { environment.dismissStartupError() }
        } message: {
            Text(environment.startupError ?? "")
        }
    }

    private var selectedSection: ControlPanelSection {
        ControlPanelSection.resolve(storedSelection)
    }

    private var selection: Binding<ControlPanelSection?> {
        Binding(
            get: { selectedSection },
            set: { storedSelection = ($0 ?? .usage).rawValue }
        )
    }

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                Image(systemName: "waveform")
                    .font(.system(size: 17, weight: .semibold))
                Text("Mouthpiece")
                    .font(.headline)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 8)

            List(ControlPanelSection.allCases, selection: selection) { section in
                Label {
                    Text(section.title)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                } icon: {
                    Image(systemName: section.icon)
                }
                    .tag(section)
                    .help(section.title)
            }
            .listStyle(.sidebar)
            .scrollContentBackground(.hidden)
        }
        .background(SidebarGlassBackground())
        .navigationSplitViewColumnWidth(min: 188, ideal: 196, max: 204)
    }

    @ViewBuilder
    private func detail(for section: ControlPanelSection) -> some View {
        switch section {
        case .usage: UsageSettingsView()
        case .dictation: DictationSettingsView()
        case .processing: ProcessingSettingsView()
        case .vocabulary: VocabularyRulesView()
        case .history: HistoryView()
        case .privacy: PrivacyDiagnosticsView()
        }
    }
}

private struct ControlPanelWindowConfiguration: NSViewRepresentable {
    final class WindowProbe: NSView {
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            ControlPanelWindowConfiguration.configure(window)
        }
    }

    func makeNSView(context: Context) -> WindowProbe {
        WindowProbe(frame: .zero)
    }

    func updateNSView(_ nsView: WindowProbe, context: Context) {}

    @MainActor
    private static func configure(_ window: NSWindow) {
        let currentSize = window.frame.size
        window.minSize = ControlPanelWindowMetrics.minimumWindowSize
        window.standardWindowButton(.zoomButton)?.isEnabled = true
        window.collectionBehavior.insert(.fullScreenPrimary)
        if currentSize.width < ControlPanelWindowMetrics.minimumWindowSize.width
            || currentSize.height < ControlPanelWindowMetrics.minimumWindowSize.height {
            window.setContentSize(ControlPanelWindowMetrics.defaultContentSize)
            window.center()
        }
    }
}
