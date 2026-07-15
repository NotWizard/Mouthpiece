import AppKit
import Darwin

struct AudioCuePreset: Identifiable, Equatable, Sendable {
    let id: String
    let nameKey: String
    let startSound: String
    let stopSound: String
}

@MainActor
final class AudioCueService {
    static let presets: [AudioCuePreset] = [
        .init(id: "classic", nameKey: "soundPreset.classic", startSound: "Tink", stopSound: "Pop"),
        .init(id: "retro-arcade", nameKey: "soundPreset.retroArcade", startSound: "Ping", stopSound: "Funk"),
        .init(id: "bubble-pop", nameKey: "soundPreset.bubblePop", startSound: "Purr", stopSound: "Pop"),
        .init(id: "sci-fi", nameKey: "soundPreset.sciFi", startSound: "Submarine", stopSound: "Morse"),
        .init(id: "marimba", nameKey: "soundPreset.marimba", startSound: "Glass", stopSound: "Tink"),
        .init(id: "playful-bounce", nameKey: "soundPreset.playfulBounce", startSound: "Pop", stopSound: "Purr"),
        .init(id: "robot", nameKey: "soundPreset.robot", startSound: "Morse", stopSound: "Submarine"),
        .init(id: "gentle-chime", nameKey: "soundPreset.gentleChime", startSound: "Glass", stopSound: "Ping"),
        .init(id: "typewriter", nameKey: "soundPreset.typewriter", startSound: "Tink", stopSound: "Tink"),
        .init(id: "coin-collect", nameKey: "soundPreset.coinCollect", startSound: "Hero", stopSound: "Ping"),
        .init(id: "laser-zap", nameKey: "soundPreset.laserZap", startSound: "Funk", stopSound: "Submarine"),
        .init(id: "whistle", nameKey: "soundPreset.whistle", startSound: "Blow", stopSound: "Bottle"),
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

actor MediaPlaybackController {
    private typealias GetPlaybackState = @convention(c) (
        DispatchQueue,
        @escaping @convention(block) (UInt8) -> Void
    ) -> Void
    private typealias SendCommand = @convention(c) (Int32, CFDictionary?) -> UInt8

    private static let pauseCommand = Int32(1)
    private static let playCommand = Int32(0)
    private static let playPauseMediaKey = Int32(16)

    private let getPlaybackState: GetPlaybackState?
    private let sendCommand: SendCommand?
    private var pausedByMouthpiece = false

    init() {
        let framework = dlopen(
            "/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote",
            RTLD_LAZY | RTLD_LOCAL
        )
        getPlaybackState = Self.loadSymbol(
            "MRMediaRemoteGetNowPlayingApplicationIsPlaying",
            from: framework,
            as: GetPlaybackState.self
        )
        sendCommand = Self.loadSymbol(
            "MRMediaRemoteSendCommand",
            from: framework,
            as: SendCommand.self
        )
    }

    func pauseIfPlaying() async -> Bool {
        guard !pausedByMouthpiece, await isPlaying() == true else { return false }
        guard send(Self.pauseCommand) || Self.postPlayPauseMediaKey() else { return false }
        pausedByMouthpiece = true
        return true
    }

    func resumeIfPaused() async {
        guard pausedByMouthpiece else { return }
        pausedByMouthpiece = false
        if send(Self.playCommand) { return }

        // A media key is a toggle, so only use it when the session is still paused.
        guard await isPlaying() == false else { return }
        _ = Self.postPlayPauseMediaKey()
    }

    private func isPlaying() async -> Bool? {
        guard let getPlaybackState else { return nil }
        let request = PlaybackStateRequest()
        getPlaybackState(.global(qos: .userInitiated)) { isPlaying in
            request.resolve(isPlaying != 0)
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.35) {
            request.resolve(nil)
        }
        return await request.value()
    }

    private func send(_ command: Int32) -> Bool {
        guard let sendCommand else { return false }
        return sendCommand(command, nil) != 0
    }

    private static func loadSymbol<T>(
        _ name: String,
        from framework: UnsafeMutableRawPointer?,
        as type: T.Type
    ) -> T? {
        guard let framework, let symbol = dlsym(framework, name) else { return nil }
        return unsafeBitCast(symbol, to: type)
    }

    private static func postPlayPauseMediaKey() -> Bool {
        func post(isKeyDown: Bool) -> Bool {
            let keyState = Int32(isKeyDown ? 0xA : 0xB)
            guard let event = NSEvent.otherEvent(
                with: .systemDefined,
                location: .zero,
                modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: 0,
                context: nil,
                subtype: 8,
                data1: Int((playPauseMediaKey << 16) | (keyState << 8)),
                data2: -1
            )?.cgEvent else { return false }
            event.post(tap: .cghidEventTap)
            return true
        }

        return post(isKeyDown: true) && post(isKeyDown: false)
    }
}

private final class PlaybackStateRequest: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Bool?, Never>?
    private var result: Bool?
    private var isResolved = false

    func value() async -> Bool? {
        await withCheckedContinuation { continuation in
            lock.lock()
            if isResolved {
                let result = result
                lock.unlock()
                continuation.resume(returning: result)
            } else {
                self.continuation = continuation
                lock.unlock()
            }
        }
    }

    func resolve(_ value: Bool?) {
        lock.lock()
        guard !isResolved else {
            lock.unlock()
            return
        }
        isResolved = true
        result = value
        let continuation = continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: value)
    }
}
