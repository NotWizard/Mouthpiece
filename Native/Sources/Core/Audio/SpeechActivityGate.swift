import Foundation

struct SpeechActivityGate: Sendable {
    struct Result: Equatable, Sendable {
        let rms: Double
        let visualLevel: Float
        let speechDetected: Bool
        let speechDetectedEver: Bool
    }

    private static let minimumNoiseFloor = 0.0015
    private static let minimumSpeechRMS = 0.014
    private static let openSNR = 10.0
    private static let closeSNR = 6.0
    private static let minimumSpeechMilliseconds = 220
    private static let hangoverMilliseconds = 320
    private static let preRollMilliseconds = 300
    // Capsule waveform: absolute loudness window and ballistics (20ms frames).
    private static let visualFloorDBFS = -50.0
    private static let visualTopDBFS = -6.0
    private static let visualAttackAlpha: Float = 0.39
    private static let visualReleaseAlpha: Float = 0.087

    private let sampleRate: Int
    private var stage = Stage.idle
    private var activeMilliseconds = 0
    private var silenceMilliseconds = 0
    private var noiseFloor = Self.minimumNoiseFloor
    private var totalBytes = 0
    private var candidateStartByte: Int?
    private var firstSpeechByte: Int?
    private var lastSpeechByte: Int?
    private var visualLevel: Float = 0
    private(set) var speechDetectedEver = false
    private(set) var peakRMS = 0.0

    init(sampleRate: Int = AudioCaptureService.outputSampleRate) {
        self.sampleRate = sampleRate
    }

    mutating func consume(_ pcm16: Data, rms precomputedRMS: Double? = nil) -> Result {
        let frameStart = totalBytes
        totalBytes += pcm16.count
        let frameMilliseconds = max(1, pcm16.count * 1_000 / max(1, sampleRate * 2))
        let rms = precomputedRMS ?? Self.rms(pcm16)
        peakRMS = max(peakRMS, rms)
        let snr = 20 * log10(max(Self.minimumNoiseFloor, rms) / max(Self.minimumNoiseFloor, noiseFloor))
        let aboveOpen = rms >= Self.minimumSpeechRMS && snr >= Self.openSNR
        let aboveClose = rms >= Self.minimumSpeechRMS * 0.62 && snr >= Self.closeSNR
        var speechDetected = false

        switch stage {
        case .speaking, .hangover:
            if aboveClose {
                stage = .speaking
                activeMilliseconds = max(Self.minimumSpeechMilliseconds, activeMilliseconds + frameMilliseconds)
                silenceMilliseconds = 0
                speechDetected = true
                lastSpeechByte = totalBytes
            } else {
                silenceMilliseconds += frameMilliseconds
                if silenceMilliseconds <= Self.hangoverMilliseconds {
                    stage = .hangover
                    speechDetected = true
                } else {
                    stage = .idle
                    activeMilliseconds = 0
                    silenceMilliseconds = 0
                    candidateStartByte = nil
                }
            }
        case .idle, .preSpeech:
            if aboveOpen {
                if stage == .idle { candidateStartByte = frameStart }
                stage = .preSpeech
                activeMilliseconds += frameMilliseconds
                silenceMilliseconds = 0
                if activeMilliseconds >= Self.minimumSpeechMilliseconds {
                    stage = .speaking
                    speechDetected = true
                    speechDetectedEver = true
                    let preRollBytes = sampleRate * 2 * Self.preRollMilliseconds / 1_000
                    firstSpeechByte = max(0, (candidateStartByte ?? frameStart) - preRollBytes)
                    lastSpeechByte = totalBytes
                }
            } else {
                stage = .idle
                activeMilliseconds = 0
                silenceMilliseconds = 0
                candidateStartByte = nil
            }
        }

        let activeForNoise = stage == .speaking || stage == .hangover || aboveOpen
        if !activeForNoise || rms <= noiseFloor {
            let alpha = activeForNoise ? 0.015 : 0.08
            noiseFloor += (max(Self.minimumNoiseFloor, rms) - noiseFloor) * alpha
        }
        // Capsule waveform level: gate on speech activity so ambient noise stays
        // flat, then map absolute loudness (dBFS) onto a fixed [-50, -6] window,
        // independent of the adaptive floor. Fast attack / slow release keeps it
        // responsive rising and smooth ("breathing") falling.
        let gateOpen = aboveOpen || stage == .speaking || stage == .hangover
        let visualTarget: Float
        if gateOpen {
            let dbfs = 20 * log10(max(rms, 1e-7))
            let normalized = (dbfs - Self.visualFloorDBFS) / (Self.visualTopDBFS - Self.visualFloorDBFS)
            visualTarget = Float(min(max(normalized, 0), 1))
        } else {
            visualTarget = 0
        }
        let visualAlpha = visualTarget > visualLevel ? Self.visualAttackAlpha : Self.visualReleaseAlpha
        visualLevel += (visualTarget - visualLevel) * visualAlpha
        speechDetectedEver = speechDetectedEver || speechDetected
        return Result(
            rms: rms,
            visualLevel: visualLevel,
            speechDetected: speechDetected,
            speechDetectedEver: speechDetectedEver
        )
    }

    func trimmed(_ pcm16: Data) -> Data {
        guard speechDetectedEver, let firstSpeechByte, let lastSpeechByte else { return pcm16 }
        let tailBytes = sampleRate * 2 * Self.hangoverMilliseconds / 1_000
        let lower = min(max(0, firstSpeechByte), pcm16.count)
        let upper = min(pcm16.count, max(lower, lastSpeechByte + tailBytes))
        return Data(pcm16[lower..<upper])
    }

    private enum Stage: Sendable {
        case idle
        case preSpeech
        case speaking
        case hangover
    }

    private static func rms(_ pcm16: Data) -> Double {
        guard pcm16.count >= 2 else { return 0 }
        var sum = 0.0
        var count = 0
        pcm16.withUnsafeBytes { bytes in
            for offset in stride(from: 0, to: bytes.count - 1, by: 2) {
                let value = Int16(bitPattern: UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8)
                let normalized = Double(value) / 32_768
                sum += normalized * normalized
                count += 1
            }
        }
        return count == 0 ? 0 : sqrt(sum / Double(count))
    }
}
