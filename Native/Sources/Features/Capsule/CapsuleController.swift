import AppKit
import SwiftUI

@MainActor
final class CapsuleViewModel: ObservableObject {
    @Published var snapshot: DictationSnapshot = .idle
    @Published var language = UILanguage.system
    var onCancel: (() -> Void)?
}

@MainActor
final class CapsuleController {
    private static let positionsKey = "capsule.positions.v1"
    let model = CapsuleViewModel()
    private let panel: NSPanel
    private let defaults: UserDefaults
    private var observers: [NSObjectProtocol] = []
    private var isProgrammaticMove = false

    init(defaults: UserDefaults? = nil) {
        self.defaults = defaults ?? Self.defaultStore()
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 300, height: 58),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.contentView = NSHostingView(rootView: CapsuleView(model: model))

        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.repositionIfVisible() }
        })
        observers.append(center.addObserver(
            forName: NSWindow.didMoveNotification,
            object: panel,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.persistCurrentPosition() }
        })
        observers.append(center.addObserver(
            forName: NSWorkspace.didWakeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.repositionIfVisible() }
        })
    }

    func show(_ snapshot: DictationSnapshot) {
        model.snapshot = snapshot
        reposition()
        panel.orderFrontRegardless()
    }

    func update(_ snapshot: DictationSnapshot) {
        model.snapshot = snapshot
        if snapshot.phase.isActive || snapshot.phase == .failed {
            if !panel.isVisible { show(snapshot) }
        }
    }

    func hide() {
        panel.orderOut(nil)
    }

    func setLanguage(_ language: UILanguage) {
        model.language = language
    }

    func repositionIfVisible() {
        if panel.isVisible { reposition() }
    }

    private func reposition() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let visible = screen?.visibleFrame else { return }
        let origin = restoredOrigin(on: screen!, visibleFrame: visible) ?? NSPoint(
            x: visible.midX - panel.frame.width / 2,
            y: visible.maxY - panel.frame.height - 20
        )
        isProgrammaticMove = true
        panel.setFrameOrigin(origin)
        isProgrammaticMove = false
    }

    private func persistCurrentPosition() {
        guard panel.isVisible, !isProgrammaticMove, let screen = panel.screen,
              let identifier = displayIdentifier(screen) else { return }
        let visible = screen.visibleFrame
        guard visible.width > panel.frame.width, visible.height > panel.frame.height else { return }
        let x = (panel.frame.minX - visible.minX) / (visible.width - panel.frame.width)
        let y = (panel.frame.minY - visible.minY) / (visible.height - panel.frame.height)
        var positions = defaults.dictionary(forKey: Self.positionsKey) ?? [:]
        positions[identifier] = ["x": min(1, max(0, x)), "y": min(1, max(0, y))]
        defaults.set(positions, forKey: Self.positionsKey)
    }

    private func restoredOrigin(on screen: NSScreen, visibleFrame: NSRect) -> NSPoint? {
        guard let identifier = displayIdentifier(screen),
              let positions = defaults.dictionary(forKey: Self.positionsKey),
              let value = positions[identifier] as? [String: Double],
              let normalizedX = value["x"], let normalizedY = value["y"] else { return nil }
        return NSPoint(
            x: visibleFrame.minX + min(1, max(0, normalizedX)) * (visibleFrame.width - panel.frame.width),
            y: visibleFrame.minY + min(1, max(0, normalizedY)) * (visibleFrame.height - panel.frame.height)
        )
    }

    private func displayIdentifier(_ screen: NSScreen) -> String? {
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              let uuid = CGDisplayCreateUUIDFromDisplayID(CGDirectDisplayID(number.uint32Value)) else {
            return nil
        }
        return CFUUIDCreateString(nil, uuid.takeRetainedValue()) as String
    }

    private static func defaultStore() -> UserDefaults {
        guard ProcessInfo.processInfo.environment["MOUTHPIECE_DATA_ROOT"] != nil else {
            return .standard
        }
        let suite = "com.mouthpiece.app.automation.\(ProcessInfo.processInfo.processIdentifier)"
        return UserDefaults(suiteName: suite) ?? .standard
    }
}

private struct CapsuleView: View {
    @ObservedObject var model: CapsuleViewModel

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .symbolEffect(.pulse, isActive: model.snapshot.phase == .recording)
                .foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                if !model.snapshot.partialText.isEmpty {
                    Text(model.snapshot.partialText)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            if model.snapshot.phase.isActive {
                if model.snapshot.isTranslation {
                    Image(systemName: "translate")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.blue)
                        .help(AppLocalization.string("processing.translation", language: model.language))
                }
                AudioMeter(level: model.snapshot.audioLevel)
                Button {
                    model.onCancel?()
                } label: {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.plain)
                .help(AppLocalization.string("common.cancel", language: model.language))
            }
        }
        .padding(.horizontal, 14)
        .frame(width: 300, height: 58)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().stroke(.primary.opacity(0.1), lineWidth: 0.5))
    }

    private var icon: String {
        switch model.snapshot.phase {
        case .preparing: "ellipsis"
        case .recording: "waveform"
        case .stopping, .finalizing: "hourglass"
        case .inserting: "text.cursor"
        case .failed: "exclamationmark.triangle"
        default: "checkmark"
        }
    }

    private var title: String {
        switch model.snapshot.phase {
        case .preparing: AppLocalization.string("capsule.preparing", language: model.language)
        case .recording: AppLocalization.string("capsule.listening", language: model.language)
        case .stopping, .finalizing: AppLocalization.string("capsule.transcribing", language: model.language)
        case .inserting: AppLocalization.string("capsule.inserting", language: model.language)
        case .failed: model.snapshot.errorMessage ?? AppLocalization.string("capsule.failed", language: model.language)
        default: AppLocalization.string("app.ready", language: model.language)
        }
    }

    private var tint: Color {
        model.snapshot.phase == .failed ? .red : .accentColor
    }
}

private struct AudioMeter: View {
    let level: Float

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(0..<4, id: \.self) { index in
                Capsule()
                    .fill(Color.accentColor.opacity(Double(level) > Double(index) * 0.2 ? 1 : 0.25))
                    .frame(width: 2, height: 6 + CGFloat(index % 2) * 6)
            }
        }
        .frame(width: 18, height: 20)
    }
}
