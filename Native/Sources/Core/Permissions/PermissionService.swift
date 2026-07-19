import AppKit
import AVFoundation
@preconcurrency import ApplicationServices
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
        panel.orderOut(nil)
        if updatePositionFromSystemSettings() {
            panel.orderFrontRegardless()
        }

        monitorTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled else { return }
                if self?.updatePositionFromSystemSettings() == true,
                   self?.panel.isVisible == false {
                    self?.panel.orderFrontRegardless()
                }
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

    @discardableResult
    private func updatePositionFromSystemSettings() -> Bool {
        guard let settingsFrame = Self.systemSettingsWindowFrame() else { return false }
        guard settingsFrame != lastSettingsFrame else { return true }
        lastSettingsFrame = settingsFrame
        positionPanel(nextTo: settingsFrame)
        return true
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
        let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)
            as? [[String: Any]] ?? []
        guard let cgFrame = SystemSettingsWindowLocator.frame(
            from: windows,
            bundleIdentifierForPID: { pid in
                NSRunningApplication(processIdentifier: pid)?.bundleIdentifier
            }
        ) else { return nil }
        return appKitFrame(for: cgFrame)
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

enum SystemSettingsWindowLocator {
    private static let bundleIdentifiers = [
        "com.apple.settings.PrivacySecurity.extension",
        "com.apple.systempreferences",
    ]

    static func frame(
        from windows: [[String: Any]],
        bundleIdentifierForPID: (pid_t) -> String?
    ) -> CGRect? {
        for window in windows {
            guard (window[kCGWindowLayer as String] as? Int) == 0,
                  (window[kCGWindowIsOnscreen as String] as? Bool) != false,
                  let pid = window[kCGWindowOwnerPID as String] as? pid_t,
                  let bundleIdentifier = bundleIdentifierForPID(pid),
                  bundleIdentifiers.contains(bundleIdentifier),
                  let bounds = window[kCGWindowBounds as String] as? [String: Any],
                  let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
                  frame.width > 300,
                  frame.height > 300 else { continue }
            return frame
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
                Image(systemName: "togglepower")
                    .font(.system(size: 18))
                    .foregroundStyle(.tint)
            }
            .contentShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .onDrag {
                NSItemProvider(object: appURL as NSURL)
            }
            .padding(12)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(.tint.opacity(0.35), lineWidth: 1)
            )

            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(localized("permissions.guide.waiting"))
                    Text(localized("permissions.guide.existing"))
                }
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
