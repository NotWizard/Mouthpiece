import Cocoa
import Foundation
import Darwin

// We listen for both modifier-state changes (flagsChanged) and regular key
// presses (keyDown). flagsChanged drives the existing push-to-talk semantics
// for modifier-only main hotkeys (Globe / Right Command / Right Option / …),
// while keyDown drives the translation hotkey, which is always a combo of
// "main hotkey modifier(s) + a regular key" (e.g. Globe+K). When a keyDown
// fires we emit a single line of the form
//
//     KEY_DOWN_WITH_MODS:Mod1+Mod2+...+Key
//
// where the modifier tokens match the canonical tokens used by the JS
// hotkeyValidator (GLOBE, Command, Control, Alt, Shift, RightCommand,
// RightControl, RightOption, RightShift) and Key is a printable JS-style
// label (single uppercase letter / digit, "F8", "Space", "PageUp", etc.).
let mask: CGEventMask =
    CGEventMask(1 << CGEventType.flagsChanged.rawValue) |
    CGEventMask(1 << CGEventType.keyDown.rawValue)

var fnIsDown = false
var eventTap: CFMachPort?
var lastModifierFlags: CGEventFlags = []

// Modifier keyCode tables. Each entry pairs a macOS virtual keyCode with the
// flag bit Carbon raises while that modifier is held and the JS-side token we
// emit. Tracking left / right separately lets us reconstruct the exact
// modifier prefix at keyDown time even though event.flags only reports the
// modifier *class* (e.g. Command is held), not the side.
let rightModifiers: [(Int64, CGEventFlags, String)] = [
    (61, .maskAlternate, "RightOption"),
    (54, .maskCommand, "RightCommand"),
    (62, .maskControl, "RightControl"),
    (60, .maskShift, "RightShift"),
]

let leftModifiers: [(Int64, CGEventFlags, String)] = [
    (58, .maskAlternate, "Alt"),
    (55, .maskCommand, "Command"),
    (59, .maskControl, "Control"),
    (56, .maskShift, "Shift"),
]

let modifierMask: CGEventFlags = [.maskControl, .maskCommand, .maskAlternate, .maskShift]

let releases: [(CGEventFlags, String)] = [
    (.maskControl, "control"),
    (.maskCommand, "command"),
    (.maskAlternate, "option"),
    (.maskShift, "shift"),
]

// Currently-held modifier tokens. Updated on every flagsChanged event so a
// later keyDown can reconstruct the full chord. Globe/Fn lives in fnIsDown
// because it isn't part of the regular modifier mask.
var heldModifiers: Set<String> = []

// The translation-hotkey chord we should SWALLOW (not just observe) on
// keyDown. main.js sends it via stdin whenever the renderer's settings
// change (and clears it when translation is disabled). Without swallowing,
// the original keyDown reaches the active app's input method and Right-
// Shift+X ends up surfacing an "X" candidate in the IME popup even when
// we've already routed the chord to the translation pipeline.
var translationChord: String? = nil
let translationChordLock = NSLock()

func setTranslationChord(_ chord: String?) {
    translationChordLock.lock()
    defer { translationChordLock.unlock() }
    if let chord, !chord.isEmpty {
        translationChord = chord
    } else {
        translationChord = nil
    }
}

func currentTranslationChord() -> String? {
    translationChordLock.lock()
    defer { translationChordLock.unlock() }
    return translationChord
}

// Order modifier tokens to match src/utils/hotkeyBuilder.js MODIFIER_SORT_ORDER
// so the emitted hotkey string lines up with what the renderer persisted.
let modifierSortOrder: [String] = [
    "GLOBE", "Fn",
    "Command", "RightCommand",
    "Control", "RightControl",
    "Alt", "RightOption", "RightAlt",
    "Shift", "RightShift",
]

func modifierSortRank(_ token: String) -> Int {
    if let idx = modifierSortOrder.firstIndex(of: token) {
        return idx
    }
    return modifierSortOrder.count
}

// macOS virtual keyCode → canonical hotkey token. We deliberately limit this
// to the keys exposed by the renderer's HotkeyInput picker so the emitted
// token always round-trips with the stored hotkey string. Unknown keyCodes
// produce no event, which matches the renderer never allowing them as
// hotkeys in the first place.
let keyCodeToToken: [Int64: String] = [
    0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C", 9: "V",
    11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T",
    18: "1", 19: "2", 20: "3", 21: "4", 22: "6", 23: "5", 24: "=", 25: "9", 26: "7",
    27: "-", 28: "8", 29: "0",
    30: "]", 31: "O", 32: "U", 33: "[", 34: "I", 35: "P",
    36: "Enter", 37: "L", 38: "J", 39: "'", 40: "K", 41: ";", 42: "\\",
    43: ",", 44: "/", 45: "N", 46: "M", 47: ".",
    48: "Tab", 49: "Space", 50: "`", 51: "Backspace", 53: "Esc",
    96: "F5", 97: "F6", 98: "F7", 99: "F3", 100: "F8", 101: "F9",
    103: "F11", 105: "F13", 106: "F16", 107: "F14",
    109: "F10", 111: "F12", 113: "F15",
    115: "Home", 116: "PageUp", 117: "Delete", 118: "F4", 119: "End", 120: "F2",
    121: "PageDown", 122: "F1",
    123: "Left", 124: "Right", 125: "Down", 126: "Up",
    64: "F17", 79: "F18", 80: "F19", 90: "F20",
]

func emit(_ message: String) {
    FileHandle.standardOutput.write((message + "\n").data(using: .utf8)!)
    fflush(stdout)
}

func updateHeldSideModifier(keyCode: Int64, flags: CGEventFlags) {
    for (code, flag, token) in rightModifiers where keyCode == code {
        if flags.contains(flag) {
            heldModifiers.insert(token)
        } else {
            heldModifiers.remove(token)
        }
        return
    }
    for (code, flag, token) in leftModifiers where keyCode == code {
        if flags.contains(flag) {
            heldModifiers.insert(token)
        } else {
            heldModifiers.remove(token)
        }
        return
    }
}

// When a modifier flag clears but we didn't see the specific keyCode (e.g.
// the user released several modifiers in quick succession), drop any tokens
// whose flag is no longer present in the global event.flags so heldModifiers
// can't drift out of sync with the OS state.
func reconcileHeldModifiers(currentFlags: CGEventFlags) {
    if !currentFlags.contains(.maskCommand) {
        heldModifiers.remove("Command")
        heldModifiers.remove("RightCommand")
    }
    if !currentFlags.contains(.maskControl) {
        heldModifiers.remove("Control")
        heldModifiers.remove("RightControl")
    }
    if !currentFlags.contains(.maskAlternate) {
        heldModifiers.remove("Alt")
        heldModifiers.remove("RightOption")
    }
    if !currentFlags.contains(.maskShift) {
        heldModifiers.remove("Shift")
        heldModifiers.remove("RightShift")
    }
}

func buildKeyDownHotkey(keyCode: Int64) -> String? {
    guard let token = keyCodeToToken[keyCode] else { return nil }

    var modifiers = Array(heldModifiers)
    if fnIsDown {
        modifiers.append("GLOBE")
    }

    modifiers.sort { modifierSortRank($0) < modifierSortRank($1) }
    if modifiers.isEmpty {
        return token
    }
    return modifiers.joined(separator: "+") + "+" + token
}

func eventTapCallback(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
    }

    let flags = event.flags

    if type == .keyDown {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        // Reconcile in case we missed a release event for a modifier the OS
        // already cleared; this keeps the emitted chord honest.
        reconcileHeldModifiers(currentFlags: flags)
        if let hotkey = buildKeyDownHotkey(keyCode: keyCode) {
            emit("KEY_DOWN_WITH_MODS:\(hotkey)")
            // Swallow the keyDown when the chord matches the translation
            // hotkey so the active app's input method never sees the
            // primary key. Modifier-only main hotkeys are unaffected because
            // they don't carry a primary key and never match this branch.
            if let trans = currentTranslationChord(), trans == hotkey {
                return nil
            }
        }
        return Unmanaged.passUnretained(event)
    }

    let containsFn = flags.contains(.maskSecondaryFn)

    if containsFn && !fnIsDown {
        fnIsDown = true
        emit("FN_DOWN")
    } else if !containsFn && fnIsDown {
        fnIsDown = false
        emit("FN_UP")
    }

    let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
    for (code, flag, name) in rightModifiers {
        if keyCode == code {
            emit(flags.contains(flag) ? "RIGHT_MOD_DOWN:\(name)" : "RIGHT_MOD_UP:\(name)")
            break
        }
    }

    // Track per-side modifier state for KEY_DOWN_WITH_MODS reconstruction.
    updateHeldSideModifier(keyCode: keyCode, flags: flags)

    let currentModifiers = flags.intersection(modifierMask)
    if currentModifiers != lastModifierFlags {
        let released = lastModifierFlags.subtracting(currentModifiers)
        for (flag, name) in releases {
            if released.contains(flag) {
                emit("MODIFIER_UP:\(name)")
            }
        }
        lastModifierFlags = currentModifiers
        reconcileHeldModifiers(currentFlags: currentModifiers)
    }

    return Unmanaged.passUnretained(event)
}

guard let createdTap = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap,
                                         place: .tailAppendEventTap,
                                         // .defaultTap (not .listenOnly) so the callback can
                                         // return nil to swallow the translation-hotkey keyDown
                                         // and prevent the active app's input method from
                                         // surfacing the primary key (e.g. an "X" candidate in
                                         // a Chinese IME when Right-Shift+X fires translation).
                                         options: .defaultTap,
                                         eventsOfInterest: mask,
                                         callback: eventTapCallback,
                                         userInfo: nil) else {
    FileHandle.standardError.write("Failed to create event tap\n".data(using: .utf8)!)
    exit(1)
}

eventTap = createdTap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, createdTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: createdTap, enable: true)

// Background stdin reader so the parent process can push the current
// translation-hotkey chord into the listener without re-spawning. Protocol:
//   "SET_TRANSLATION_CHORD:<chord>\n"   — start swallowing this chord
//   "CLEAR_TRANSLATION_CHORD\n"          — stop swallowing
// Anything else is ignored.
let stdinQueue = DispatchQueue(label: "globe-listener.stdin", qos: .utility)
stdinQueue.async {
    while let raw = readLine(strippingNewline: true) {
        let line = raw.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("SET_TRANSLATION_CHORD:") {
            let chord = String(line.dropFirst("SET_TRANSLATION_CHORD:".count))
                .trimmingCharacters(in: .whitespaces)
            setTranslationChord(chord)
        } else if line == "CLEAR_TRANSLATION_CHORD" {
            setTranslationChord(nil)
        }
    }
}

let signalSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
signalSource.setEventHandler {
    CFRunLoopStop(CFRunLoopGetCurrent())
}
signalSource.resume()

CFRunLoopRun()
