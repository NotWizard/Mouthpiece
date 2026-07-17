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
        case "rightshift", "right shift":
            return HotkeyDescriptor(keyCode: 60, modifiers: .maskShift, modifierOnly: true)
        case "leftshift", "left shift":
            return HotkeyDescriptor(keyCode: 56, modifiers: .maskShift, modifierOnly: true)
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
            if part == "fn" || part == "globe" { flags.insert(.maskSecondaryFn) }
        }
        return HotkeyDescriptor(keyCode: keyCode, modifiers: flags, modifierOnly: false)
    }

    private static let keyCodes: [String: CGKeyCode] = [
        "space": 49, "return": 36, "enter": 36, "tab": 48,
        "escape": 53, "esc": 53,
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5,
        "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12,
        "w": 13, "e": 14, "r": 15, "y": 16, "t": 17,
        "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23,
        "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35,
        "l": 37, "j": 38, "'": 39, "k": 40, ";": 41, "\\": 42,
        ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "`": 50,
        "delete": 51, "forwarddelete": 117,
        "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "left": 123, "right": 124, "down": 125, "up": 126,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118,
        "f5": 96, "f6": 97, "f7": 98, "f8": 100,
        "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    ]
}

enum TranslationHotkey {
    static let defaultSuffix = ","

    static func combination(dictationKey: String, suffix: String) -> String? {
        let modifier: String
        switch dictationKey.lowercased().filter({ !$0.isWhitespace }) {
        case "rightcommand", "leftcommand": modifier = "Command"
        case "rightshift", "leftshift": modifier = "Shift"
        case "rightoption", "leftoption", "rightalt", "leftalt": modifier = "Option"
        case "rightcontrol", "leftcontrol": modifier = "Control"
        case "fn", "globe": modifier = "Fn"
        default: return nil
        }
        guard let suffix = normalizedSuffix(suffix) else { return nil }
        return "\(modifier)+\(suffix)"
    }

    static func suffix(from value: String) -> String? {
        normalizedSuffix(value.split(separator: "+").last.map(String.init) ?? value)
    }

    static func normalizedSuffix(_ value: String) -> String? {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !clean.isEmpty else { return nil }
        switch clean {
        case "comma": return ","
        case "period": return "."
        case "slash": return "/"
        case "semicolon": return ";"
        case "space": return "Space"
        case "return", "enter": return "Return"
        default: return clean.count == 1 ? clean : nil
        }
    }
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

    var isRunning: Bool { eventTap != nil }

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
        guard isRunning else {
            try start(key: key)
            return
        }
        descriptor = .parse(key)
        pressed = false
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
        if HotkeyService.shouldDispatch(type: type, keyCode: keyCode, descriptor: service.descriptor) {
            Task { @MainActor in
                service.handle(type: type, keyCode: keyCode, flags: flags)
            }
        }
        return shouldSwallow ? nil : Unmanaged.passUnretained(event)
    }

    nonisolated static func shouldDispatch(
        type: CGEventType,
        keyCode: CGKeyCode,
        descriptor: HotkeyDescriptor
    ) -> Bool {
        type == .tapDisabledByTimeout
            || type == .tapDisabledByUserInput
            || keyCode == descriptor.keyCode
    }

    nonisolated static func matchesShortcutEvent(
        type: CGEventType,
        keyCode: CGKeyCode,
        flags: CGEventFlags,
        descriptor: HotkeyDescriptor
    ) -> Bool {
        guard keyCode == descriptor.keyCode else { return false }
        if descriptor.modifierOnly {
            return type == .flagsChanged && flags.intersection(descriptor.modifiers) == descriptor.modifiers
        }
        let relevantFlags: CGEventFlags = [
            .maskCommand,
            .maskAlternate,
            .maskControl,
            .maskShift,
            .maskSecondaryFn,
        ]
        return (type == .keyDown || type == .keyUp)
            && flags.intersection(relevantFlags) == descriptor.modifiers
    }

    private func handle(type: CGEventType, keyCode: CGKeyCode, flags: CGEventFlags) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let eventTap { CGEvent.tapEnable(tap: eventTap, enable: true) }
            return
        }
        guard keyCode == descriptor.keyCode else { return }
        if descriptor.modifierOnly {
            let isNowPressed = flags.intersection(descriptor.modifiers) == descriptor.modifiers
            setPressed(isNowPressed)
        } else if type == .keyDown,
                  Self.matchesShortcutEvent(
                      type: type,
                      keyCode: keyCode,
                      flags: flags,
                      descriptor: descriptor
                  ) {
            setPressed(true)
        } else if type == .keyUp {
            setPressed(false)
        }
    }

    private nonisolated func matches(type: CGEventType, keyCode: CGKeyCode, flags: CGEventFlags) -> Bool {
        Self.matchesShortcutEvent(
            type: type,
            keyCode: keyCode,
            flags: flags,
            descriptor: descriptor
        )
    }

    private func setPressed(_ value: Bool) {
        guard value != pressed else { return }
        pressed = value
        if value { onPress?() } else { onRelease?() }
    }
}
