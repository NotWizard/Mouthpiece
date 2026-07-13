import AppKit
import CoreGraphics

struct HotkeyDescriptor: Equatable, Sendable {
    let keyCode: CGKeyCode
    let modifiers: CGEventFlags
    let modifierOnly: Bool

    static func parse(_ value: String) -> HotkeyDescriptor {
        switch value.lowercased() {
        case "rightcommand", "right command":
            return HotkeyDescriptor(keyCode: 54, modifiers: .maskCommand, modifierOnly: true)
        case "leftcommand", "left command":
            return HotkeyDescriptor(keyCode: 55, modifiers: .maskCommand, modifierOnly: true)
        case "rightoption", "right option", "rightalt":
            return HotkeyDescriptor(keyCode: 61, modifiers: .maskAlternate, modifierOnly: true)
        case "leftoption", "left option", "leftalt":
            return HotkeyDescriptor(keyCode: 58, modifiers: .maskAlternate, modifierOnly: true)
        case "rightcontrol", "right control":
            return HotkeyDescriptor(keyCode: 62, modifiers: .maskControl, modifierOnly: true)
        case "leftcontrol", "left control":
            return HotkeyDescriptor(keyCode: 59, modifiers: .maskControl, modifierOnly: true)
        case "fn", "globe":
            return HotkeyDescriptor(keyCode: 63, modifiers: .maskSecondaryFn, modifierOnly: true)
        default:
            return parseCombination(value) ?? HotkeyDescriptor(
                keyCode: 54,
                modifiers: .maskCommand,
                modifierOnly: true
            )
        }
    }

    private static func parseCombination(_ value: String) -> HotkeyDescriptor? {
        let parts = value.lowercased().split(separator: "+").map(String.init)
        guard let key = parts.last, let keyCode = keyCodes[key] else { return nil }
        var flags: CGEventFlags = []
        for part in parts.dropLast() {
            if part == "command" || part == "cmd" { flags.insert(.maskCommand) }
            if part == "option" || part == "alt" { flags.insert(.maskAlternate) }
            if part == "control" || part == "ctrl" { flags.insert(.maskControl) }
            if part == "shift" { flags.insert(.maskShift) }
        }
        return HotkeyDescriptor(keyCode: keyCode, modifiers: flags, modifierOnly: false)
    }

    private static let keyCodes: [String: CGKeyCode] = [
        "space": 49, "return": 36, "enter": 36, "tab": 48,
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5,
        "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
        "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
        "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
        "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "o": 31, "u": 32, "i": 34, "p": 35, "l": 37, "j": 38,
        "k": 40, "n": 45, "m": 46,
    ]
}

@MainActor
final class HotkeyService {
    private nonisolated let swallowMatchedEvents: Bool
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private nonisolated(unsafe) var descriptor = HotkeyDescriptor.parse("RightCommand")
    private var pressed = false
    var onPress: (() -> Void)?
    var onRelease: (() -> Void)?
    var onEscape: (() -> Void)?

    init(swallowMatchedEvents: Bool = false) {
        self.swallowMatchedEvents = swallowMatchedEvents
    }

    func start(key: String) throws {
        stop()
        descriptor = .parse(key)
        let mask = (1 << CGEventType.flagsChanged.rawValue)
            | (1 << CGEventType.keyDown.rawValue)
            | (1 << CGEventType.keyUp.rawValue)
            | (1 << CGEventType.tapDisabledByTimeout.rawValue)
            | (1 << CGEventType.tapDisabledByUserInput.rawValue)
        let pointer = Unmanaged.passUnretained(self).toOpaque()
        guard let tap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: swallowMatchedEvents ? .defaultTap : .listenOnly,
            eventsOfInterest: CGEventMask(mask),
            callback: Self.callback,
            userInfo: pointer
        ) else {
            throw TextInsertionError.insertionFailed(.apiDisabled)
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        eventTap = tap
        runLoopSource = source
    }

    func update(key: String) throws {
        try start(key: key)
    }

    func stop() {
        if let runLoopSource {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        }
        if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: false) }
        runLoopSource = nil
        eventTap = nil
        pressed = false
    }

    private static let callback: CGEventTapCallBack = { _, type, event, userInfo in
        guard let userInfo else { return Unmanaged.passUnretained(event) }
        let service = Unmanaged<HotkeyService>.fromOpaque(userInfo).takeUnretainedValue()
        let keyCode = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        let flags = event.flags
        let shouldSwallow = service.swallowMatchedEvents
            && service.matches(type: type, keyCode: keyCode, flags: flags)
        Task { @MainActor in
            service.handle(type: type, keyCode: keyCode, flags: flags)
        }
        return shouldSwallow ? nil : Unmanaged.passUnretained(event)
    }

    private func handle(type: CGEventType, keyCode: CGKeyCode, flags: CGEventFlags) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            return
        }
        if type == .keyDown, keyCode == 53 {
            onEscape?()
            return
        }
        guard keyCode == descriptor.keyCode else { return }
        let relevantFlags: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift, .maskSecondaryFn]
        if descriptor.modifierOnly {
            let isNowPressed = flags.intersection(descriptor.modifiers) == descriptor.modifiers
            setPressed(isNowPressed)
        } else if type == .keyDown,
                  flags.intersection(relevantFlags).intersection(descriptor.modifiers) == descriptor.modifiers {
            setPressed(true)
        } else if type == .keyUp {
            setPressed(false)
        }
    }

    private nonisolated func matches(type: CGEventType, keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
        guard keyCode == descriptor.keyCode else { return false }
        let relevantFlags: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift, .maskSecondaryFn]
        if descriptor.modifierOnly {
            return type == .flagsChanged && flags.intersection(descriptor.modifiers) == descriptor.modifiers
        }
        return (type == .keyDown || type == .keyUp)
            && flags.intersection(relevantFlags).intersection(descriptor.modifiers) == descriptor.modifiers
    }

    private func setPressed(_ value: Bool) {
        guard value != pressed else { return }
        pressed = value
        if value { onPress?() } else { onRelease?() }
    }
}
