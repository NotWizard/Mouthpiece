import AppKit
import QuartzCore
import SwiftUI

@MainActor
final class CapsuleWaveformModel: ObservableObject {
    @Published private(set) var levels = CapsuleLevelHistory().samples
    private var levelHistory = CapsuleLevelHistory()

    func update(_ level: Float) {
        levelHistory.append(level)
        levels = levelHistory.samples
    }

    func reset() {
        levelHistory.reset()
        levels = levelHistory.samples
    }
}

@MainActor
final class CapsuleViewModel: ObservableObject {
    @Published private(set) var snapshot: DictationSnapshot = .idle
    @Published private(set) var targetApplicationName = "Current App"
    @Published private(set) var targetApplicationIcon: NSImage?
    @Published var language = UILanguage.system

    let waveform = CapsuleWaveformModel()

    func apply(_ snapshot: DictationSnapshot) {
        if snapshot.sessionID != self.snapshot.sessionID {
            waveform.reset()
        }
        self.snapshot = snapshot
        if snapshot.phase != .recording && snapshot.phase != .preparing {
            waveform.reset()
        }
    }

    func updateAudioLevel(_ level: Float, sessionID: UUID) {
        guard snapshot.sessionID == sessionID, snapshot.phase == .recording else { return }
        waveform.update(level)
    }

    func setTarget(processIdentifier: pid_t?, applicationName: String?) {
        targetApplicationName = applicationName ?? AppLocalization.string(
            "capsule.currentApplication",
            language: language
        )
        targetApplicationIcon = processIdentifier
            .flatMap(NSRunningApplication.init(processIdentifier:))?
            .icon
    }

}

struct CapsuleLevelHistory: Equatable {
    private(set) var samples: [Float]

    init(sampleCount: Int = 36) {
        samples = Array(repeating: 0, count: max(1, sampleCount))
    }

    mutating func append(_ level: Float) {
        samples.removeFirst()
        samples.append(min(max(level, 0), 1))
    }

    mutating func reset() {
        samples = Array(repeating: 0, count: samples.count)
    }
}

private enum CapsuleLayout {
    static let width: CGFloat = 280
    static let height: CGFloat = 86
    static let shadowInset: CGFloat = 18
    static let windowWidth = width + shadowInset * 2
    static let windowHeight = height + shadowInset * 2
}

enum CapsuleContentKind: Equatable {
    case identity
    case status
    case transcript
    case error

    static func resolve(_ snapshot: DictationSnapshot) -> Self {
        if snapshot.phase == .failed { return .error }
        if !snapshot.partialText.isEmpty { return .transcript }
        switch snapshot.phase {
        case .preparing, .stopping, .finalizing, .inserting, .completed: return .status
        default: return .identity
        }
    }
}

@MainActor
final class CapsuleController {
    let model = CapsuleViewModel()
    private let panel: NSPanel
    private var observers: [NSObjectProtocol] = []
    private var targetProcessIdentifier: pid_t?

    init() {
        panel = NSPanel(
            contentRect: NSRect(
                x: 0,
                y: 0,
                width: CapsuleLayout.windowWidth,
                height: CapsuleLayout.windowHeight
            ),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.level = .statusBar
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = false
        panel.isMovableByWindowBackground = false
        panel.ignoresMouseEvents = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        let hostingView = NSHostingView(rootView: CapsuleView(model: model))
        hostingView.wantsLayer = true
        hostingView.layer?.backgroundColor = NSColor.clear.cgColor
        panel.contentView = hostingView

        let center = NotificationCenter.default
        observers.append(center.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.repositionIfVisible() }
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
        model.apply(snapshot)
        reposition()
        panel.orderFrontRegardless()
    }

    func update(_ snapshot: DictationSnapshot) {
        model.apply(snapshot)
        if snapshot.phase.isActive || snapshot.phase == .failed {
            if !panel.isVisible { show(snapshot) }
        }
    }

    func updateAudioLevel(_ level: Float, sessionID: UUID) {
        model.updateAudioLevel(level, sessionID: sessionID)
    }

    func hide() {
        panel.orderOut(nil)
    }

    func setLanguage(_ language: UILanguage) {
        model.language = language
    }

    func setTarget(processIdentifier: pid_t?, applicationName: String?) {
        targetProcessIdentifier = processIdentifier
        model.setTarget(processIdentifier: processIdentifier, applicationName: applicationName)
    }

    func repositionIfVisible() {
        if panel.isVisible { reposition() }
    }

    private func reposition() {
        let mouse = NSEvent.mouseLocation
        let screen = targetProcessIdentifier.flatMap(Self.screenContainingFrontWindow)
            ?? NSScreen.screens.first(where: { NSMouseInRect(mouse, $0.frame, false) })
            ?? NSScreen.main
            ?? NSScreen.screens.first
        guard let visible = screen?.visibleFrame else { return }
        let origin = NSPoint(
            x: visible.midX - panel.frame.width / 2,
            y: visible.minY + 18 - CapsuleLayout.shadowInset
        )
        panel.setFrameOrigin(origin)
    }

    private static func screenContainingFrontWindow(processIdentifier: pid_t) -> NSScreen? {
        let windows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] ?? []
        guard let windowFrame = CapsuleTargetWindowLocator.frame(
            processIdentifier: processIdentifier,
            windows: windows
        ) else { return nil }

        return NSScreen.screens.max { lhs, rhs in
            intersectionArea(of: windowFrame, with: displayFrame(for: lhs))
                < intersectionArea(of: windowFrame, with: displayFrame(for: rhs))
        }.flatMap { screen in
            intersectionArea(of: windowFrame, with: displayFrame(for: screen)) > 0 ? screen : nil
        }
    }

    private static func displayFrame(for screen: NSScreen) -> CGRect {
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return .null
        }
        return CGDisplayBounds(CGDirectDisplayID(number.uint32Value))
    }

    private static func intersectionArea(of lhs: CGRect, with rhs: CGRect) -> CGFloat {
        guard !rhs.isNull else { return 0 }
        let intersection = lhs.intersection(rhs)
        return intersection.isNull ? 0 : intersection.width * intersection.height
    }
}

enum CapsuleTargetWindowLocator {
    static func frame(processIdentifier: pid_t, windows: [[String: Any]]) -> CGRect? {
        for window in windows {
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                  (window[kCGWindowIsOnscreen as String] as? Bool) != false,
                  (window[kCGWindowOwnerPID as String] as? pid_t) == processIdentifier,
                  (window[kCGWindowAlpha as String] as? Double ?? 1) > 0,
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                  frame.width > 1,
                  frame.height > 1 else { continue }
            return frame
        }
        return nil
    }
}

private struct CapsuleView: View {
    @ObservedObject var model: CapsuleViewModel
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            topContent
                .id(contentKind)
                .transition(.opacity)
                .frame(maxWidth: .infinity, minHeight: 34, maxHeight: 34, alignment: .topLeading)

            CapsuleWaveform(model: model.waveform)
                .frame(maxWidth: .infinity, minHeight: 21, maxHeight: 21)
                .opacity(contentKind == .error ? 0 : 1)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .frame(
            width: CapsuleLayout.width,
            height: CapsuleLayout.height
        )
        .background {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.thinMaterial)
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(surfaceTint)
                }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(borderTint, lineWidth: 0.8)
        )
        .shadow(color: shadowTint, radius: 12, y: 5)
        .padding(CapsuleLayout.shadowInset)
        .frame(width: CapsuleLayout.windowWidth, height: CapsuleLayout.windowHeight)
        .animation(.easeOut(duration: 0.14), value: contentKind)
    }

    private var contentKind: CapsuleContentKind {
        CapsuleContentKind.resolve(model.snapshot)
    }

    @ViewBuilder
    private var topContent: some View {
        switch contentKind {
        case .identity:
            identityRow
        case .status:
            Text(statusText ?? "")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        case .transcript:
            RollingTranscriptView(text: model.snapshot.partialText)
        case .error:
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(.red)
                Text(model.snapshot.errorMessage ?? AppLocalization.string(
                    "capsule.failed",
                    language: model.language
                ))
                .lineLimit(2)
            }
            .font(.system(size: 11.5, weight: .medium))
        }
    }

    private var identityRow: some View {
        HStack(spacing: 7) {
            applicationIcon(model.targetApplicationIcon, fallback: "app.fill")
                .frame(width: 18, height: 18)
            Text(model.targetApplicationName)
                .font(.system(size: 13, weight: .semibold))
                .lineLimit(1)
                .layoutPriority(1)

            Spacer(minLength: 10)

            HStack(spacing: 4) {
                MouthpieceBrandIcon(size: 13, compact: true)
                Text("Mouthpiece")
                    .font(.system(size: 12, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(.tertiary)
        }
    }

    private var surfaceTint: LinearGradient {
        let colors: [Color] = if colorScheme == .dark {
            [Color(nsColor: .windowBackgroundColor).opacity(0.58), Color.black.opacity(0.12)]
        } else {
            [Color.white.opacity(0.46), Color(red: 0.84, green: 0.92, blue: 0.91).opacity(0.16)]
        }
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    private var borderTint: LinearGradient {
        LinearGradient(
            colors: [
                Color.primary.opacity(colorScheme == .dark ? 0.24 : 0.15),
                model.snapshot.phase == .recording
                    ? Color.accentColor.opacity(0.28)
                    : Color.primary.opacity(0.08),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var shadowTint: Color {
        colorScheme == .dark ? Color.black.opacity(0.34) : Color.black.opacity(0.18)
    }

    private var statusText: String? {
        switch model.snapshot.phase {
        case .preparing: AppLocalization.string("capsule.preparing", language: model.language)
        case .recording: nil
        case .stopping, .finalizing: AppLocalization.string("capsule.transcribing", language: model.language)
        case .inserting: AppLocalization.string("capsule.inserting", language: model.language)
        case .completed: AppLocalization.string("capsule.success", language: model.language)
        default: nil
        }
    }

    @ViewBuilder
    private func applicationIcon(_ image: NSImage?, fallback: String) -> some View {
        if let image {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
        } else {
            Image(systemName: fallback)
                .resizable()
                .scaledToFit()
                .foregroundStyle(.secondary)
                .padding(2)
        }
    }
}

private struct RollingTranscriptView: View {
    let text: String
    private let bottomID = "capsule-transcript-bottom"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(text)
                        .font(.system(size: 12, weight: .medium))
                        .lineSpacing(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Color.clear
                        .frame(height: 1)
                        .id(bottomID)
                }
                .frame(maxWidth: .infinity, minHeight: 34, alignment: .topLeading)
            }
            .scrollIndicators(.hidden)
            .allowsHitTesting(false)
            .onAppear {
                proxy.scrollTo(bottomID, anchor: .bottom)
            }
            .onChange(of: text) {
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(bottomID, anchor: .bottom)
                }
            }
        }
        .frame(height: 34)
        .clipped()
    }
}

private struct CapsuleWaveform: NSViewRepresentable {
    @ObservedObject var model: CapsuleWaveformModel

    func makeNSView(context: Context) -> CapsuleWaveformView {
        let view = CapsuleWaveformView()
        view.update(model.levels)
        return view
    }

    func updateNSView(_ nsView: CapsuleWaveformView, context: Context) {
        nsView.update(model.levels)
    }
}

private final class CapsuleWaveformView: NSView {
    private let spacing: CGFloat = 2.5
    private var targetLevels: [CGFloat] = []
    private var displayedLevels: [CGFloat] = []
    private var displayLink: CADisplayLink?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard window != nil else {
            displayLink?.invalidate()
            displayLink = nil
            return
        }
        guard displayLink == nil else { return }
        let link = displayLink(target: self, selector: #selector(drawFrame(_:)))
        link.add(to: .main, forMode: .common)
        link.isPaused = displayedLevels == targetLevels
        displayLink = link
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }

    func update(_ levels: [Float]) {
        targetLevels = levels.map { CGFloat(min(max($0, 0), 1)) }
        if displayedLevels.count != targetLevels.count {
            displayedLevels = targetLevels
        }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            displayedLevels = targetLevels
            displayLink?.isPaused = true
            needsDisplay = true
        } else if displayedLevels != targetLevels {
            displayLink?.isPaused = false
        }
    }

    @objc private func drawFrame(_ link: CADisplayLink) {
        guard displayedLevels.count == targetLevels.count else { return }
        let delta = max(1.0 / 240.0, min(link.targetTimestamp - link.timestamp, 1.0 / 30.0))
        let interpolation = CGFloat(1 - exp(-delta * 24))
        var moving = false

        for index in displayedLevels.indices {
            let difference = targetLevels[index] - displayedLevels[index]
            if abs(difference) > 0.001 {
                displayedLevels[index] += difference * interpolation
                moving = true
            } else {
                displayedLevels[index] = targetLevels[index]
            }
        }

        needsDisplay = true
        link.isPaused = !moving
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard !displayedLevels.isEmpty else { return }
        let barWidth = CapsuleWaveformLayout.barWidth(
            totalWidth: bounds.width,
            sampleCount: displayedLevels.count,
            spacing: spacing
        )

        effectiveAppearance.performAsCurrentDrawingAppearance {
            NSColor.labelColor.withAlphaComponent(0.72).setFill()
            for (index, level) in displayedLevels.enumerated() {
                let height = CapsuleWaveformLayout.barHeight(for: Float(level))
                let rect = NSRect(
                    x: CGFloat(index) * (barWidth + spacing),
                    y: (bounds.height - height) / 2,
                    width: barWidth,
                    height: height
                )
                NSBezierPath(
                    roundedRect: rect,
                    xRadius: min(barWidth, height) / 2,
                    yRadius: min(barWidth, height) / 2
                ).fill()
            }
        }
    }
}

enum CapsuleWaveformLayout {
    static func barWidth(totalWidth: CGFloat, sampleCount: Int, spacing: CGFloat) -> CGFloat {
        guard sampleCount > 0 else { return 0 }
        let gaps = CGFloat(sampleCount - 1) * spacing
        return max(2, (totalWidth - gaps) / CGFloat(sampleCount))
    }

    static func barHeight(for level: Float) -> CGFloat {
        let clamped = CGFloat(min(max(level, 0), 1))
        return 5 + pow(clamped, 0.58) * 16
    }
}
