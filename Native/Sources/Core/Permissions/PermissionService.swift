import AppKit
import AVFoundation
import ApplicationServices
import SwiftUI

struct PermissionSnapshot: Equatable, Sendable {
    let microphone: Bool
    let accessibility: Bool

    var allGranted: Bool { microphone && accessibility }
}

@MainActor
final class PermissionService {
    private let accessibilityGuide = AccessibilityPermissionGuideController()

    func current() -> PermissionSnapshot {
        PermissionSnapshot(
            microphone: AVCaptureDevice.authorizationStatus(for: .audio) == .authorized,
            accessibility: AXIsProcessTrusted()
        )
    }

    func requestMicrophone() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .audio)
        default: false
        }
    }

    func requestAccessibility(
        language: UILanguage,
        onGranted: @escaping @MainActor () -> Void
    ) {
        guard !AXIsProcessTrusted() else {
            onGranted()
            return
        }
        openAccessibilitySettings()
        accessibilityGuide.show(
            language: language,
            openSettings: { [weak self] in self?.openAccessibilitySettings() },
            onGranted: onGranted
        )
    }

    func openMicrophoneSettings() {
        openSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")
    }

    func openAccessibilitySettings() {
        openSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
    }

    private func openSettings(_ value: String) {
        guard let url = URL(string: value) else { return }
        NSWorkspace.shared.open(url)
    }
}

@MainActor
private final class AccessibilityPermissionGuideController {
    private let panel: NSPanel
    private var monitorTask: Task<Void, Never>?
    private var lastSettingsFrame: NSRect?

    init() {
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 230),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: true
        )
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = false
        panel.isMovableByWindowBackground = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }

    func show(
        language: UILanguage,
        openSettings: @escaping () -> Void,
        onGranted: @escaping @MainActor () -> Void
    ) {
        monitorTask?.cancel()
        panel.contentView = NSHostingView(rootView: AccessibilityPermissionGuideView(
            language: language,
            appURL: Bundle.main.bundleURL,
            openSettings: openSettings,
            close: { [weak self] in self?.hide() }
        ))
        lastSettingsFrame = nil
        updatePositionFromSystemSettings()
        panel.orderFrontRegardless()

        monitorTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                guard !Task.isCancelled else { return }
                self?.updatePositionFromSystemSettings()
                if AXIsProcessTrusted() {
                    onGranted()
                    self?.hide()
                    return
                }
            }
        }
    }

    private func hide() {
        monitorTask?.cancel()
        monitorTask = nil
        lastSettingsFrame = nil
        panel.orderOut(nil)
    }

    private func updatePositionFromSystemSettings() {
        guard let settingsFrame = Self.systemSettingsWindowFrame(),
              settingsFrame != lastSettingsFrame else { return }
        lastSettingsFrame = settingsFrame
        positionPanel(nextTo: settingsFrame)
    }

    private func positionPanel(nextTo settingsFrame: NSRect) {
        guard let screen = NSScreen.screens.first(where: { $0.frame.intersects(settingsFrame) })
            ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let inset: CGFloat = 12
        let rightX = settingsFrame.maxX + inset
        let x = rightX + panel.frame.width <= visible.maxX
            ? rightX
            : max(visible.minX + inset, settingsFrame.minX - panel.frame.width - inset)
        panel.setFrameOrigin(NSPoint(
            x: x,
            y: max(visible.minY + inset, min(settingsFrame.midY - panel.frame.height / 2, visible.maxY - panel.frame.height - inset))
        ))
    }

    private static func systemSettingsWindowFrame() -> NSRect? {
        let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
        for window in windows {
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                  let pid = window[kCGWindowOwnerPID as String] as? Int32,
                  let bundleID = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier,
                  bundleID == "com.apple.settings.PrivacySecurity.extension"
                    || bundleID == "com.apple.systempreferences",
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let cgFrame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                  cgFrame.width > 300,
                  cgFrame.height > 300 else { continue }
            return appKitFrame(for: cgFrame)
        }
        return nil
    }

    private static func appKitFrame(for cgFrame: CGRect) -> NSRect? {
        for screen in NSScreen.screens {
            guard let screenNumber = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                continue
            }
            let cgScreen = CGDisplayBounds(CGDirectDisplayID(screenNumber.uint32Value))
            guard cgScreen.intersects(cgFrame) else { continue }
            return NSRect(
                x: screen.frame.minX + cgFrame.minX - cgScreen.minX,
                y: screen.frame.maxY - (cgFrame.minY - cgScreen.minY) - cgFrame.height,
                width: cgFrame.width,
                height: cgFrame.height
            )
        }
        return nil
    }
}

private struct AccessibilityPermissionGuideView: View {
    let language: UILanguage
    let appURL: URL
    let openSettings: () -> Void
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(localized("permissions.guide.title"))
                    .font(.system(size: 17, weight: .semibold))
                Spacer()
                Button(action: close) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(localized("common.close")))
            }

            Text(localized("permissions.guide.subtitle"))
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 12) {
                Image(nsImage: NSWorkspace.shared.icon(forFile: appURL.path))
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Mouthpiece")
                        .font(.system(size: 14, weight: .semibold))
                    Text(localized("permissions.guide.drag"))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "hand.draw")
                    .font(.system(size: 18))
                    .foregroundStyle(.tint)
            }
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(.tint.opacity(0.35), lineWidth: 1)
            )
            .overlay(AppBundleDragSource(appURL: appURL))

            HStack {
                Text(localized("permissions.guide.waiting"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                Button(localized("permissions.openSettings"), action: openSettings)
            }
        }
        .padding(20)
        .frame(width: 360, height: 230)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(.primary.opacity(0.12), lineWidth: 0.5)
        )
    }

    private func localized(_ key: String) -> String {
        AppLocalization.string(key, language: language)
    }
}

private struct AppBundleDragSource: NSViewRepresentable {
    let appURL: URL

    func makeNSView(context: Context) -> AppBundleDragSourceView {
        AppBundleDragSourceView(appURL: appURL)
    }

    func updateNSView(_ nsView: AppBundleDragSourceView, context: Context) {
        nsView.appURL = appURL
    }
}

private final class AppBundleDragSourceView: NSView, NSDraggingSource {
    var appURL: URL

    init(appURL: URL) {
        self.appURL = appURL
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .openHand)
    }

    override func mouseDragged(with event: NSEvent) {
        let icon = NSWorkspace.shared.icon(forFile: appURL.path)
        let point = convert(event.locationInWindow, from: nil)
        let item = NSDraggingItem(pasteboardWriter: appURL as NSURL)
        item.setDraggingFrame(
            NSRect(x: point.x - 24, y: point.y - 24, width: 48, height: 48),
            contents: icon
        )
        beginDraggingSession(with: [item], event: event, source: self)
    }

    func draggingSession(
        _ session: NSDraggingSession,
        sourceOperationMaskFor context: NSDraggingContext
    ) -> NSDragOperation {
        .copy
    }
}
