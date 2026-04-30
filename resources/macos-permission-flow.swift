import AppKit
import CoreGraphics
import Foundation

private struct HelperConfig {
    let appURL: URL
    let sourceFrame: CGRect?
    let title: String
    let instruction: String
    let doneLabel: String
}

private func emit(_ type: String, _ extra: [String: Any] = [:]) {
    var payload = extra
    payload["type"] = type
    guard
        let data = try? JSONSerialization.data(withJSONObject: payload),
        let line = String(data: data, encoding: .utf8)
    else {
        return
    }
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    fflush(stdout)
}

private func parseConfig() -> HelperConfig? {
    let args = CommandLine.arguments.dropFirst()
    var appPath: String?
    var sourceFrame: CGRect?
    var title = "Accessibility"
    var instruction: String?
    var doneLabel = "Done"
    var iterator = args.makeIterator()

    while let arg = iterator.next() {
        switch arg {
        case "--app":
            appPath = iterator.next()
        case "--source":
            guard
                let xRaw = iterator.next(),
                let yRaw = iterator.next(),
                let widthRaw = iterator.next(),
                let heightRaw = iterator.next(),
                let x = Double(xRaw),
                let y = Double(yRaw),
                let width = Double(widthRaw),
                let height = Double(heightRaw),
                width > 0,
                height > 0
            else {
                continue
            }
            sourceFrame = CGRect(x: x, y: y, width: width, height: height)
        case "--title":
            if let value = iterator.next() {
                title = value
            }
        case "--instruction":
            if let value = iterator.next() {
                instruction = value
            }
        case "--done-label":
            if let value = iterator.next() {
                doneLabel = value
            }
        default:
            continue
        }
    }

    guard let appPath else {
        emit("error", ["message": "Missing --app path"])
        return nil
    }

    let appURL = URL(fileURLWithPath: appPath).standardizedFileURL
    guard appURL.pathExtension.lowercased() == "app" else {
        emit("error", ["message": "The --app path must point to a .app bundle"])
        return nil
    }

    let displayName = FileManager.default.displayName(atPath: appURL.path)
    return HelperConfig(
        appURL: appURL,
        sourceFrame: sourceFrame,
        title: title,
        instruction: instruction ?? "Drag \(displayName) to the list above to allow Accessibility.",
        doneLabel: doneLabel
    )
}

private struct SettingsWindowSnapshot {
    let frame: CGRect
    let visibleFrame: CGRect
}

private enum SettingsWindowLocator {
    static let bundleIdentifier = "com.apple.systempreferences"

    static func frontmostWindow() -> SettingsWindowSnapshot? {
        guard NSWorkspace.shared.frontmostApplication?.bundleIdentifier == bundleIdentifier else {
            return nil
        }
        guard
            let app = NSRunningApplication
                .runningApplications(withBundleIdentifier: bundleIdentifier)
                .max(by: { lhs, rhs in
                    (lhs.activationPolicy == .prohibited ? 0 : 1) <
                        (rhs.activationPolicy == .prohibited ? 0 : 1)
                }),
            let windowInfo = CGWindowListCopyWindowInfo(
                [.optionOnScreenOnly, .excludeDesktopElements],
                .zero
            ) as? [[String: Any]]
        else {
            return nil
        }

        let windows = windowInfo.compactMap { info -> SettingsWindowSnapshot? in
            guard
                let ownerPID = info[kCGWindowOwnerPID as String] as? pid_t,
                ownerPID == app.processIdentifier,
                let layer = info[kCGWindowLayer as String] as? Int,
                layer == 0,
                let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
            else {
                return nil
            }

            let cgFrame = CGRect(
                x: bounds["X"] ?? 0,
                y: bounds["Y"] ?? 0,
                width: bounds["Width"] ?? 0,
                height: bounds["Height"] ?? 0
            )
            let converted = appKitGeometry(from: cgFrame)
            guard converted.frame.width > 320, converted.frame.height > 240 else {
                return nil
            }
            return SettingsWindowSnapshot(frame: converted.frame, visibleFrame: converted.visibleFrame)
        }

        return windows.max { lhs, rhs in
            lhs.frame.width * lhs.frame.height < rhs.frame.width * rhs.frame.height
        }
    }

    private static func appKitGeometry(from cgFrame: CGRect) -> (frame: CGRect, visibleFrame: CGRect) {
        let screens = NSScreen.screens.compactMap { screen -> (frame: CGRect, visibleFrame: CGRect, cgBounds: CGRect)? in
            guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
                return nil
            }
            let displayID = CGDirectDisplayID(number.uint32Value)
            return (frame: screen.frame, visibleFrame: screen.visibleFrame, cgBounds: CGDisplayBounds(displayID))
        }

        let matchedScreen = screens
            .filter { $0.cgBounds.intersects(cgFrame) }
            .max { lhs, rhs in
                lhs.cgBounds.intersection(cgFrame).width * lhs.cgBounds.intersection(cgFrame).height <
                    rhs.cgBounds.intersection(cgFrame).width * rhs.cgBounds.intersection(cgFrame).height
            }

        guard let matchedScreen else {
            let visibleFrame = NSScreen.main?.visibleFrame ?? CGRect(origin: .zero, size: cgFrame.size)
            return (frame: cgFrame, visibleFrame: visibleFrame)
        }

        let localX = cgFrame.minX - matchedScreen.cgBounds.minX
        let localY = cgFrame.minY - matchedScreen.cgBounds.minY
        let frame = CGRect(
            x: matchedScreen.frame.minX + localX,
            y: matchedScreen.frame.maxY - localY - cgFrame.height,
            width: cgFrame.width,
            height: cgFrame.height
        )
        return (frame: frame, visibleFrame: matchedScreen.visibleFrame)
    }
}

private final class PassiveOverlayPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

private final class AppDragSourceView: NSView, NSDraggingSource {
    private let appURL: URL
    private let rowView = NSView()
    private weak var overlayWindow: NSWindow?

    init(appURL: URL, overlayWindow: NSWindow?) {
        self.appURL = appURL
        self.overlayWindow = overlayWindow
        super.init(frame: .zero)
        translatesAutoresizingMaskIntoConstraints = false
        setup()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func mouseDown(with event: NSEvent) {
        let item = NSPasteboardItem()
        item.setString(appURL.absoluteString, forType: .fileURL)

        let draggingItem = NSDraggingItem(pasteboardWriter: item)
        draggingItem.setDraggingFrame(rowView.frame, contents: draggingImage())

        let session = beginDraggingSession(with: [draggingItem], event: event, source: self)
        session.animatesToStartingPositionsOnCancelOrFail = true
    }

    func draggingSession(_ session: NSDraggingSession, willBeginAt screenPoint: NSPoint) {
        rowView.isHidden = true
        overlayWindow?.ignoresMouseEvents = true
        emit("drag-started")
    }

    func draggingSession(_ session: NSDraggingSession, sourceOperationMaskFor context: NSDraggingContext) -> NSDragOperation {
        .copy
    }

    func draggingSession(_ session: NSDraggingSession, endedAt screenPoint: NSPoint, operation: NSDragOperation) {
        rowView.isHidden = false
        overlayWindow?.ignoresMouseEvents = false
        emit("drag-ended")
    }

    private func setup() {
        wantsLayer = true
        rowView.wantsLayer = true
        rowView.layer?.cornerRadius = 7
        rowView.layer?.borderWidth = 1
        rowView.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.28).cgColor
        rowView.layer?.backgroundColor = NSColor.controlBackgroundColor.withAlphaComponent(0.82).cgColor
        rowView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(rowView)

        let iconChrome = NSView()
        iconChrome.wantsLayer = true
        iconChrome.layer?.cornerRadius = 6
        iconChrome.layer?.backgroundColor = NSColor.white.withAlphaComponent(0.9).cgColor
        iconChrome.translatesAutoresizingMaskIntoConstraints = false
        rowView.addSubview(iconChrome)

        let iconView = NSImageView(image: NSWorkspace.shared.icon(forFile: appURL.path))
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconChrome.addSubview(iconView)

        let label = NSTextField(labelWithString: FileManager.default.displayName(atPath: appURL.path))
        label.font = .systemFont(ofSize: 14, weight: .semibold)
        label.lineBreakMode = .byTruncatingTail
        label.translatesAutoresizingMaskIntoConstraints = false
        rowView.addSubview(label)

        NSLayoutConstraint.activate([
            rowView.leadingAnchor.constraint(equalTo: leadingAnchor),
            rowView.trailingAnchor.constraint(equalTo: trailingAnchor),
            rowView.topAnchor.constraint(equalTo: topAnchor),
            rowView.bottomAnchor.constraint(equalTo: bottomAnchor),

            iconChrome.leadingAnchor.constraint(equalTo: rowView.leadingAnchor, constant: 10),
            iconChrome.centerYAnchor.constraint(equalTo: rowView.centerYAnchor),
            iconChrome.widthAnchor.constraint(equalToConstant: 26),
            iconChrome.heightAnchor.constraint(equalToConstant: 26),

            iconView.centerXAnchor.constraint(equalTo: iconChrome.centerXAnchor),
            iconView.centerYAnchor.constraint(equalTo: iconChrome.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 22),
            iconView.heightAnchor.constraint(equalToConstant: 22),

            label.leadingAnchor.constraint(equalTo: iconChrome.trailingAnchor, constant: 10),
            label.trailingAnchor.constraint(equalTo: rowView.trailingAnchor, constant: -12),
            label.centerYAnchor.constraint(equalTo: rowView.centerYAnchor),
        ])
    }

    private func draggingImage() -> NSImage {
        let image = NSImage(size: rowView.bounds.size)
        image.lockFocus()
        rowView.displayIgnoringOpacity(rowView.bounds, in: NSGraphicsContext.current!)
        image.unlockFocus()
        return image
    }
}

private final class OverlayContentView: NSView {
    private let onClose: () -> Void

    init(config: HelperConfig, overlayWindow: NSWindow?, onClose: @escaping () -> Void) {
        self.onClose = onClose
        super.init(frame: NSRect(x: 0, y: 0, width: 530, height: 120))
        translatesAutoresizingMaskIntoConstraints = false
        setup(config: config, overlayWindow: overlayWindow)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setup(config: HelperConfig, overlayWindow: NSWindow?) {
        let material = NSVisualEffectView()
        material.translatesAutoresizingMaskIntoConstraints = false
        material.material = .popover
        material.blendingMode = .behindWindow
        material.state = .active
        material.wantsLayer = true
        material.layer?.cornerRadius = 18
        material.layer?.masksToBounds = true
        addSubview(material)

        let titleLabel = NSTextField(labelWithString: config.title)
        titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        material.addSubview(titleLabel)

        let instructionLabel = NSTextField(labelWithString: config.instruction)
        instructionLabel.font = .systemFont(ofSize: 12, weight: .regular)
        instructionLabel.textColor = .secondaryLabelColor
        instructionLabel.maximumNumberOfLines = 2
        instructionLabel.lineBreakMode = .byWordWrapping
        instructionLabel.translatesAutoresizingMaskIntoConstraints = false
        material.addSubview(instructionLabel)

        let closeButton = NSButton(title: config.doneLabel, target: self, action: #selector(closePressed))
        closeButton.bezelStyle = .rounded
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        material.addSubview(closeButton)

        let dragSource = AppDragSourceView(appURL: config.appURL, overlayWindow: overlayWindow)
        material.addSubview(dragSource)

        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: 530),
            heightAnchor.constraint(equalToConstant: 120),
            material.leadingAnchor.constraint(equalTo: leadingAnchor),
            material.trailingAnchor.constraint(equalTo: trailingAnchor),
            material.topAnchor.constraint(equalTo: topAnchor),
            material.bottomAnchor.constraint(equalTo: bottomAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: material.leadingAnchor, constant: 18),
            titleLabel.topAnchor.constraint(equalTo: material.topAnchor, constant: 12),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: closeButton.leadingAnchor, constant: -12),

            closeButton.trailingAnchor.constraint(equalTo: material.trailingAnchor, constant: -16),
            closeButton.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),

            instructionLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            instructionLabel.trailingAnchor.constraint(equalTo: material.trailingAnchor, constant: -18),
            instructionLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 4),

            dragSource.leadingAnchor.constraint(equalTo: material.leadingAnchor, constant: 18),
            dragSource.trailingAnchor.constraint(equalTo: material.trailingAnchor, constant: -18),
            dragSource.topAnchor.constraint(equalTo: instructionLabel.bottomAnchor, constant: 10),
            dragSource.heightAnchor.constraint(equalToConstant: 43),
        ])
    }

    @objc
    private func closePressed() {
        onClose()
    }
}

private final class OverlayWindowController: NSWindowController {
    private let windowSize = NSSize(width: 530, height: 120)

    init(config: HelperConfig, onClose: @escaping () -> Void) {
        let window = PassiveOverlayPanel(
            contentRect: NSRect(origin: .zero, size: windowSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init(window: window)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.level = .statusBar
        window.hasShadow = true
        window.hidesOnDeactivate = false
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
        window.contentView = OverlayContentView(config: config, overlayWindow: window, onClose: onClose)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func show(settingsFrame: CGRect, visibleFrame: CGRect) {
        guard let window else { return }
        window.setFrame(NSRect(origin: anchoredOrigin(for: settingsFrame, visibleFrame: visibleFrame), size: windowSize), display: true)
        window.orderFrontRegardless()
    }

    func hide() {
        window?.orderOut(nil)
    }

    private func anchoredOrigin(for settingsFrame: CGRect, visibleFrame: CGRect) -> NSPoint {
        let sidebarWidth: CGFloat = 170
        let contentMinX = settingsFrame.minX + sidebarWidth
        let contentWidth = max(settingsFrame.width - sidebarWidth, windowSize.width)
        let preferredX = contentMinX + ((contentWidth - windowSize.width) / 2) - 8
        let preferredY = settingsFrame.minY + 14
        return NSPoint(
            x: min(max(preferredX, visibleFrame.minX + 8), visibleFrame.maxX - windowSize.width - 8),
            y: min(max(preferredY, visibleFrame.minY + 8), visibleFrame.maxY - windowSize.height - 8)
        )
    }
}

private final class PermissionFlowApp: NSObject, NSApplicationDelegate {
    private let config: HelperConfig
    private var overlay: OverlayWindowController?
    private var timer: Timer?

    init(config: HelperConfig) {
        self.config = config
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        overlay = OverlayWindowController(config: config) {
            NSApp.terminate(nil)
        }

        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }

        timer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) { [weak self] _ in
            self?.refresh()
        }
        emit("ready")
        refresh()
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        emit("closed")
    }

    private func refresh() {
        guard let snapshot = SettingsWindowLocator.frontmostWindow() else {
            overlay?.hide()
            return
        }
        overlay?.show(settingsFrame: snapshot.frame, visibleFrame: snapshot.visibleFrame)
    }
}

guard let config = parseConfig() else {
    exit(2)
}

private let app = NSApplication.shared
private let delegate = PermissionFlowApp(config: config)
app.delegate = delegate

let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
signalSource.setEventHandler {
    NSApp.terminate(nil)
}
signalSource.resume()

app.run()
