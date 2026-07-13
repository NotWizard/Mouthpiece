import AppKit

struct AudioCuePreset: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let startSound: String
    let stopSound: String
}

@MainActor
final class AudioCueService {
    static let presets: [AudioCuePreset] = [
        .init(id: "classic", name: "Classic", startSound: "Tink", stopSound: "Pop"),
        .init(id: "retro-arcade", name: "Retro Arcade", startSound: "Ping", stopSound: "Funk"),
        .init(id: "bubble-pop", name: "Bubble Pop", startSound: "Purr", stopSound: "Pop"),
        .init(id: "sci-fi", name: "Sci-Fi", startSound: "Submarine", stopSound: "Morse"),
        .init(id: "marimba", name: "Marimba", startSound: "Glass", stopSound: "Tink"),
        .init(id: "playful-bounce", name: "Playful Bounce", startSound: "Pop", stopSound: "Purr"),
        .init(id: "robot", name: "Robot", startSound: "Morse", stopSound: "Submarine"),
        .init(id: "gentle-chime", name: "Gentle Chime", startSound: "Glass", stopSound: "Ping"),
        .init(id: "typewriter", name: "Typewriter", startSound: "Tink", stopSound: "Tink"),
        .init(id: "coin-collect", name: "Coin Collect", startSound: "Hero", stopSound: "Ping"),
        .init(id: "laser-zap", name: "Laser Zap", startSound: "Funk", stopSound: "Submarine"),
        .init(id: "whistle", name: "Whistle", startSound: "Blow", stopSound: "Bottle"),
    ]

    private var sound: NSSound?

    func playStart(preset id: String) {
        play(name: Self.preset(id).startSound)
    }

    func playStop(preset id: String) {
        play(name: Self.preset(id).stopSound)
    }

    private func play(name: String) {
        sound?.stop()
        let url = URL(fileURLWithPath: "/System/Library/Sounds/\(name).aiff")
        sound = NSSound(contentsOf: url, byReference: true)
        sound?.volume = 0.42
        sound?.play()
    }

    private static func preset(_ id: String) -> AudioCuePreset {
        presets.first { $0.id == id } ?? presets[0]
    }
}
