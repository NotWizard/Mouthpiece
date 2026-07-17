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

    private var sidebar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 9) {
                MouthpieceBrandIcon(size: 18)
                Text("Mouthpiece")
                    .font(.headline)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.top, 14)
            .padding(.bottom, 8)

            ScrollView {
                VStack(spacing: 3) {
                    ForEach(ControlPanelSection.allCases) { section in
                        Button {
                            withAnimation(.easeOut(duration: 0.16)) {
                                storedSelection = section.rawValue
                            }
                        } label: {
                            SidebarNavigationRow(
                                section: section,
                                isSelected: section == selectedSection
                            )
                        }
                        .buttonStyle(SidebarNavigationButtonStyle())
                        .help(section.title)
                        .accessibilityAddTraits(section == selectedSection ? .isSelected : [])
                        .onMoveCommand(perform: moveSelection)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
            }
        }
        .background(SidebarGlassBackground())
        .navigationSplitViewColumnWidth(min: 188, ideal: 196, max: 204)
    }

    private func moveSelection(_ direction: MoveCommandDirection) {
        let sections = ControlPanelSection.allCases
        guard let index = sections.firstIndex(of: selectedSection) else { return }
        let nextIndex: Int
        switch direction {
        case .up:
            nextIndex = max(sections.startIndex, index - 1)
        case .down:
            nextIndex = min(sections.index(before: sections.endIndex), index + 1)
        default:
            return
        }
        storedSelection = sections[nextIndex].rawValue
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

private struct SidebarNavigationRow: View {
    @Environment(\.colorScheme) private var colorScheme

    let section: ControlPanelSection
    let isSelected: Bool

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: section.icon)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
                .scaleEffect(isSelected ? 1.06 : 1)
                .frame(width: 18)
            Text(section.title)
                .font(.body.weight(isSelected ? .semibold : .regular))
                .foregroundStyle(isSelected ? Color.primary : Color.primary.opacity(0.78))
                .lineLimit(1)
                .minimumScaleFactor(0.82)
            Spacer(minLength: 4)
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .contentShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .background {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(backgroundGradient)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(
                    isSelected ? Color.accentColor.opacity(colorScheme == .dark ? 0.28 : 0.2) : .clear,
                    lineWidth: 0.5
                )
        }
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.12)) {
                isHovered = hovering
            }
        }
        .animation(.easeOut(duration: 0.16), value: isSelected)
    }

    private var backgroundGradient: LinearGradient {
        let leadingOpacity: Double
        let trailingOpacity: Double
        if isSelected {
            leadingOpacity = colorScheme == .dark ? 0.2 : 0.16
            trailingOpacity = colorScheme == .dark ? 0.11 : 0.08
        } else if isHovered {
            leadingOpacity = colorScheme == .dark ? 0.08 : 0.055
            trailingOpacity = colorScheme == .dark ? 0.04 : 0.025
        } else {
            leadingOpacity = 0
            trailingOpacity = 0
        }
        return LinearGradient(
            colors: [
                Color.accentColor.opacity(leadingOpacity),
                Color.accentColor.opacity(trailingOpacity),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

private struct SidebarNavigationButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.78 : 1)
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
