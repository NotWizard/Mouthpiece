import AVFoundation
import AppKit
import Darwin

enum AudioCueWaveform: Hashable, Sendable {
    case sine
    case square
    case triangle
    case sawtooth
}

enum AudioCueEvent: Hashable, Sendable {
    case tone(frequency: Double, start: Double, duration: Double, waveform: AudioCueWaveform, gain: Double, attack: Double)
    case sweep(from: Double, to: Double, start: Double, duration: Double, waveform: AudioCueWaveform, gain: Double, attack: Double)
    case noise(start: Double, duration: Double, gain: Double)
    case glide(frequencies: [Double], times: [Double], start: Double, duration: Double, gain: Double)

    var endTime: Double {
        switch self {
        case .tone(_, let start, let duration, _, _, _),
             .sweep(_, _, let start, let duration, _, _, _),
             .noise(let start, let duration, _),
             .glide(_, _, let start, let duration, _):
            start + duration
        }
    }
}

struct AudioCuePreset: Identifiable, Equatable, Sendable {
    let id: String
    let nameKey: String
    let startCue: [AudioCueEvent]
    let stopCue: [AudioCueEvent]
}

@MainActor
final class AudioCueService {
    static let presets: [AudioCuePreset] = [
        .init(
            id: "classic",
            nameKey: "soundPreset.classic",
            startCue: [.tone(frequency: 523.25, start: 0, duration: 0.09, waveform: .sine, gain: 0.2, attack: 0.015), .tone(frequency: 659.25, start: 0.115, duration: 0.09, waveform: .sine, gain: 0.2, attack: 0.015)],
            stopCue: [.tone(frequency: 587.33, start: 0, duration: 0.09, waveform: .sine, gain: 0.2, attack: 0.015), .tone(frequency: 440, start: 0.115, duration: 0.09, waveform: .sine, gain: 0.2, attack: 0.015)]
        ),
        .init(
            id: "retro-arcade",
            nameKey: "soundPreset.retroArcade",
            startCue: [.tone(frequency: 523, start: 0, duration: 0.06, waveform: .square, gain: 0.12, attack: 0.005), .tone(frequency: 659, start: 0.07, duration: 0.06, waveform: .square, gain: 0.12, attack: 0.005), .tone(frequency: 784, start: 0.14, duration: 0.08, waveform: .square, gain: 0.14, attack: 0.005)],
            stopCue: [.tone(frequency: 784, start: 0, duration: 0.06, waveform: .square, gain: 0.12, attack: 0.005), .tone(frequency: 659, start: 0.07, duration: 0.06, waveform: .square, gain: 0.12, attack: 0.005), .tone(frequency: 523, start: 0.14, duration: 0.08, waveform: .square, gain: 0.1, attack: 0.005)]
        ),
        .init(
            id: "bubble-pop",
            nameKey: "soundPreset.bubblePop",
            startCue: [.sweep(from: 300, to: 900, start: 0, duration: 0.15, waveform: .sine, gain: 0.2, attack: 0.01), .sweep(from: 400, to: 1_100, start: 0.12, duration: 0.12, waveform: .sine, gain: 0.13, attack: 0.01)],
            stopCue: [.sweep(from: 800, to: 250, start: 0, duration: 0.18, waveform: .sine, gain: 0.2, attack: 0.01)]
        ),
        .init(
            id: "sci-fi",
            nameKey: "soundPreset.sciFi",
            startCue: [.sweep(from: 200, to: 1_200, start: 0, duration: 0.25, waveform: .sawtooth, gain: 0.08, attack: 0.01), .sweep(from: 600, to: 1_800, start: 0.05, duration: 0.2, waveform: .sine, gain: 0.06, attack: 0.01)],
            stopCue: [.sweep(from: 1_000, to: 200, start: 0, duration: 0.3, waveform: .sawtooth, gain: 0.08, attack: 0.01), .sweep(from: 1_400, to: 400, start: 0.05, duration: 0.25, waveform: .sine, gain: 0.05, attack: 0.01)]
        ),
        .init(
            id: "marimba",
            nameKey: "soundPreset.marimba",
            startCue: [.tone(frequency: 523, start: 0, duration: 0.12, waveform: .triangle, gain: 0.25, attack: 0.003), .tone(frequency: 659, start: 0.1, duration: 0.12, waveform: .triangle, gain: 0.25, attack: 0.003)],
            stopCue: [.tone(frequency: 659, start: 0, duration: 0.12, waveform: .triangle, gain: 0.25, attack: 0.003), .tone(frequency: 523, start: 0.1, duration: 0.15, waveform: .triangle, gain: 0.2, attack: 0.003)]
        ),
        .init(
            id: "playful-bounce",
            nameKey: "soundPreset.playfulBounce",
            startCue: [.tone(frequency: 392, start: 0, duration: 0.06, waveform: .triangle, gain: 0.18, attack: 0.005), .tone(frequency: 523, start: 0.065, duration: 0.06, waveform: .sine, gain: 0.18, attack: 0.005), .tone(frequency: 659, start: 0.13, duration: 0.06, waveform: .triangle, gain: 0.18, attack: 0.005), .tone(frequency: 880, start: 0.195, duration: 0.1, waveform: .sine, gain: 0.2, attack: 0.005)],
            stopCue: [.tone(frequency: 880, start: 0, duration: 0.07, waveform: .sine, gain: 0.18, attack: 0.005), .tone(frequency: 587, start: 0.08, duration: 0.07, waveform: .triangle, gain: 0.16, attack: 0.005), .tone(frequency: 392, start: 0.16, duration: 0.12, waveform: .sine, gain: 0.14, attack: 0.005)]
        ),
        .init(
            id: "robot",
            nameKey: "soundPreset.robot",
            startCue: [.tone(frequency: 800, start: 0, duration: 0.04, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 1_000, start: 0.06, duration: 0.04, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 800, start: 0.12, duration: 0.04, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 1_200, start: 0.18, duration: 0.06, waveform: .square, gain: 0.12, attack: 0.003)],
            stopCue: [.tone(frequency: 1_200, start: 0, duration: 0.05, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 600, start: 0.07, duration: 0.05, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 300, start: 0.14, duration: 0.1, waveform: .square, gain: 0.08, attack: 0.003)]
        ),
        .init(
            id: "gentle-chime",
            nameKey: "soundPreset.gentleChime",
            startCue: [.tone(frequency: 440, start: 0, duration: 0.25, waveform: .sine, gain: 0.15, attack: 0.04), .tone(frequency: 659, start: 0.18, duration: 0.25, waveform: .sine, gain: 0.15, attack: 0.04)],
            stopCue: [.tone(frequency: 659, start: 0, duration: 0.25, waveform: .sine, gain: 0.15, attack: 0.04), .tone(frequency: 440, start: 0.18, duration: 0.3, waveform: .sine, gain: 0.12, attack: 0.04)]
        ),
        .init(
            id: "typewriter",
            nameKey: "soundPreset.typewriter",
            startCue: [.noise(start: 0, duration: 0.03, gain: 0.3), .noise(start: 0.06, duration: 0.025, gain: 0.25)],
            stopCue: [.noise(start: 0, duration: 0.04, gain: 0.35)]
        ),
        .init(
            id: "coin-collect",
            nameKey: "soundPreset.coinCollect",
            startCue: [.tone(frequency: 988, start: 0, duration: 0.06, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 1_319, start: 0.06, duration: 0.15, waveform: .square, gain: 0.1, attack: 0.003)],
            stopCue: [.tone(frequency: 1_319, start: 0, duration: 0.06, waveform: .square, gain: 0.1, attack: 0.003), .tone(frequency: 494, start: 0.07, duration: 0.15, waveform: .square, gain: 0.08, attack: 0.003)]
        ),
        .init(
            id: "laser-zap",
            nameKey: "soundPreset.laserZap",
            startCue: [.sweep(from: 2_000, to: 200, start: 0, duration: 0.12, waveform: .sawtooth, gain: 0.08, attack: 0.003), .sweep(from: 1_800, to: 400, start: 0.1, duration: 0.1, waveform: .square, gain: 0.06, attack: 0.003)],
            stopCue: [.sweep(from: 200, to: 2_000, start: 0, duration: 0.15, waveform: .sawtooth, gain: 0.07, attack: 0.003)]
        ),
        .init(
            id: "whistle",
            nameKey: "soundPreset.whistle",
            startCue: [.glide(frequencies: [600, 1_000, 800], times: [0.1, 0.2], start: 0, duration: 0.25, gain: 0.18)],
            stopCue: [.glide(frequencies: [800, 500], times: [0.15], start: 0, duration: 0.2, gain: 0.15)]
        ),
    ]

    private var player: AVAudioPlayer?

    // Synthesized once on first use: re-rendering every sample on the main
    // actor for each play burned CPU right at recording start/stop.
    private static let cachedCues: [String: (start: Data, stop: Data)] = Dictionary(
        uniqueKeysWithValues: presets.map {
            ($0.id, (AudioCueSynthesizer.wav($0.startCue), AudioCueSynthesizer.wav($0.stopCue)))
        }
    )

    func playStart(preset id: String) {
        play(Self.cachedCues[Self.preset(id).id]?.start)
    }

    func playStop(preset id: String) {
        play(Self.cachedCues[Self.preset(id).id]?.stop)
    }

    private func play(_ wav: Data?) {
        guard let wav else { return }
        player?.stop()
        player = try? AVAudioPlayer(data: wav)
        player?.prepareToPlay()
        player?.play()
    }

    private static func preset(_ id: String) -> AudioCuePreset {
        presets.first { $0.id == id } ?? presets[0]
    }
}

enum AudioCueSynthesizer {
    static let sampleRate = 44_100

    static func wav(_ cue: [AudioCueEvent]) -> Data {
        let duration = (cue.map(\.endTime).max() ?? 0) + 0.02
        var samples = [Double](repeating: 0, count: max(1, Int(ceil(duration * Double(sampleRate)))))
        for (index, event) in cue.enumerated() {
            render(event, eventIndex: index, into: &samples)
        }

        var pcm = Data(capacity: samples.count * MemoryLayout<Int16>.size)
        for sample in samples {
            var value = Int16((max(-1, min(1, sample)) * Double(Int16.max)).rounded()).littleEndian
            withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
        }
        return WAVEncoder.pcm16Mono(pcm, sampleRate: sampleRate)
    }

    private static func render(_ event: AudioCueEvent, eventIndex: Int, into samples: inout [Double]) {
        switch event {
        case .tone(let frequency, let start, let duration, let waveform, let gain, let attack):
            renderOscillator(start: start, duration: duration, waveform: waveform, gain: gain, attack: attack, into: &samples) { _ in frequency }
        case .sweep(let from, let to, let start, let duration, let waveform, let gain, let attack):
            renderOscillator(start: start, duration: duration, waveform: waveform, gain: gain, attack: attack, into: &samples) { time in
                let progress = min(1, time / (duration * 0.8))
                return from * pow(to / from, progress)
            }
        case .noise(let start, let duration, let gain):
            renderNoise(start: start, duration: duration, gain: gain, seed: UInt64(eventIndex + 1), into: &samples)
        case .glide(let frequencies, let times, let start, let duration, let gain):
            renderGlide(frequencies: frequencies, times: times, start: start, duration: duration, gain: gain, into: &samples)
        }
    }

    private static func renderOscillator(
        start: Double,
        duration: Double,
        waveform: AudioCueWaveform,
        gain: Double,
        attack: Double,
        into samples: inout [Double],
        frequency: (Double) -> Double
    ) {
        var phase = 0.0
        renderFrames(start: start, duration: duration, into: &samples) { time in
            phase += 2 * Double.pi * frequency(time) / Double(sampleRate)
            return wave(waveform, phase: phase) * decayEnvelope(time: time, duration: duration, gain: gain, attack: attack)
        }
    }

    private static func renderGlide(
        frequencies: [Double],
        times: [Double],
        start: Double,
        duration: Double,
        gain: Double,
        into samples: inout [Double]
    ) {
        var phase = 0.0
        renderFrames(start: start, duration: duration, into: &samples) { time in
            let frequency: Double
            if frequencies.count == 3, times.count == 2, time > times[0] {
                let progress = min(1, (time - times[0]) / (times[1] - times[0]))
                frequency = frequencies[1] + (frequencies[2] - frequencies[1]) * progress
            } else {
                let end = max(times.first ?? duration, .leastNonzeroMagnitude)
                let progress = min(1, time / end)
                frequency = frequencies[0] + (frequencies[1] - frequencies[0]) * progress
            }
            phase += 2 * Double.pi * frequency / Double(sampleRate)
            let envelope: Double
            if time < 0.02 {
                envelope = gain * time / 0.02
            } else if time < duration * 0.6 {
                envelope = gain
            } else {
                let progress = (time - duration * 0.6) / (duration * 0.4)
                envelope = gain * pow(0.001 / gain, progress)
            }
            return sin(phase) * envelope
        }
    }

    private static func renderNoise(
        start: Double,
        duration: Double,
        gain: Double,
        seed: UInt64,
        into samples: inout [Double]
    ) {
        var state = seed
        renderFrames(start: start, duration: duration, into: &samples) { time in
            state = state &* 6_364_136_223_846_793_005 &+ 1
            let noise = Double(state >> 11) / Double(1 << 53) * 2 - 1
            return noise * gain * pow(0.001 / gain, time / duration)
        }
    }

    private static func renderFrames(
        start: Double,
        duration: Double,
        into samples: inout [Double],
        sample: (Double) -> Double
    ) {
        let startFrame = Int(start * Double(sampleRate))
        let frameCount = Int(duration * Double(sampleRate))
        for offset in 0..<frameCount where startFrame + offset < samples.count {
            samples[startFrame + offset] += sample(Double(offset) / Double(sampleRate))
        }
    }

    private static func decayEnvelope(time: Double, duration: Double, gain: Double, attack: Double) -> Double {
        guard time >= attack else { return gain * time / max(attack, .leastNonzeroMagnitude) }
        let progress = (time - attack) / max(duration - attack, .leastNonzeroMagnitude)
        return gain * pow(0.0001 / gain, progress)
    }

    private static func wave(_ waveform: AudioCueWaveform, phase: Double) -> Double {
        switch waveform {
        case .sine: sin(phase)
        case .square: sin(phase) >= 0 ? 1 : -1
        case .triangle: 2 / Double.pi * asin(sin(phase))
        case .sawtooth: 2 * (phase / (2 * Double.pi) - floor(phase / (2 * Double.pi) + 0.5))
        }
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
    private let adapterPerl = "/usr/bin/perl"
    private let adapterScript: String?
    private let adapterFramework: String?
    private var pausedByMouthpiece = false

    private var adapterAvailable: Bool { adapterScript != nil && adapterFramework != nil }

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
        let resources = Bundle.main.resourceURL
        let scriptPath = resources?
            .appendingPathComponent("Binaries/mediaremote/mediaremote-adapter.pl").path
        let frameworkPath = resources?
            .appendingPathComponent("Binaries/mediaremote/MediaRemoteAdapter.framework").path
        adapterScript = scriptPath.flatMap { FileManager.default.fileExists(atPath: $0) ? $0 : nil }
        adapterFramework = frameworkPath.flatMap { FileManager.default.fileExists(atPath: $0) ? $0 : nil }
    }

    func pauseIfPlaying() async -> Bool {
        guard !pausedByMouthpiece else { return false }
        if adapterAvailable {
            guard await adapterIsPlaying() == true else { return false }
            guard await adapterSend(Self.pauseCommand) else { return false }
            pausedByMouthpiece = true
            return true
        }
        guard await isPlaying() == true else { return false }
        await setPlayback(playing: false)
        pausedByMouthpiece = true
        return true
    }

    func resumeIfPaused() async {
        guard pausedByMouthpiece else { return }
        pausedByMouthpiece = false
        if adapterAvailable {
            // Only resume if it is still paused, so we never start media the user
            // stopped themselves while dictating.
            if await adapterIsPlaying() == false {
                _ = await adapterSend(Self.playCommand)
            }
            return
        }
        if await isPlaying() == false {
            await setPlayback(playing: true)
        }
    }

    private func adapterIsPlaying() async -> Bool? {
        guard let adapterScript, let adapterFramework else { return nil }
        guard let output = await Self.runAdapter(
            perl: adapterPerl,
            script: adapterScript,
            framework: adapterFramework,
            arguments: ["get"],
            timeout: 2.5
        ), let data = output.data(using: .utf8) else { return nil }
        // The adapter prints a JSON object with an always-present `playing` flag.
        guard let object = try? JSONSerialization.jsonObject(with: data),
              let payload = object as? [String: Any] else { return nil }
        return payload["playing"] as? Bool
    }

    private func adapterSend(_ command: Int32) async -> Bool {
        guard let adapterScript, let adapterFramework else { return false }
        return await Self.runAdapter(
            perl: adapterPerl,
            script: adapterScript,
            framework: adapterFramework,
            arguments: ["send", String(command)],
            timeout: 2.5
        ) != nil
    }

    private nonisolated static func runAdapter(
        perl: String,
        script: String,
        framework: String,
        arguments: [String],
        timeout: TimeInterval
    ) async -> String? {
        // SupervisedProcess drains stderr (previously ignored, so a chatty
        // adapter writing >64 KB blocked on the pipe until the SIGTERM at
        // `timeout`) and escalates SIGTERM->SIGKILL if the child ignores the
        // termination signal (audit NEW-4).
        let outcome: SupervisedProcess.Outcome
        do {
            outcome = try await SupervisedProcess.run(
                executable: URL(fileURLWithPath: perl),
                arguments: [script, framework] + arguments,
                timeout: .milliseconds(Int(timeout * 1000))
            )
        } catch {
            return nil
        }
        guard case .exited(0) = outcome.termination else { return nil }
        return String(data: outcome.stdout, encoding: .utf8) ?? ""
    }

    // MRMediaRemoteSendCommand reports success but is a silent no-op on macOS
    // 15.4+, so verify the state actually changed and fall back to the system
    // play/pause media key (which routes to the now-playing app) when it did not.
    private func setPlayback(playing shouldPlay: Bool) async {
        _ = send(shouldPlay ? Self.playCommand : Self.pauseCommand)
        if await isPlaying() == shouldPlay { return }
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
