import AVFoundation
import XCTest
@testable import Mouthpiece

final class AudioTests: XCTestCase {
    func testSelectedMicrophoneFailureHasActionableDescription() {
        XCTAssertEqual(
            AudioCaptureError.selectedInputUnavailable.errorDescription,
            "The selected microphone is unavailable. Choose another input device."
        )
    }

    @MainActor
    func testAudioCuePresetsHaveUniqueLocalizedNames() {
        XCTAssertEqual(Set(AudioCueService.presets.map(\.id)).count, AudioCueService.presets.count)
        XCTAssertEqual(Set(AudioCueService.presets.map(\.nameKey)).count, AudioCueService.presets.count)
        XCTAssertTrue(AudioCueService.presets.allSatisfy { $0.nameKey.hasPrefix("soundPreset.") })
    }

    @MainActor
    func testAudioCuePresetsRestoreDistinctSynthesizedStartAndStopSounds() {
        XCTAssertEqual(
            AudioCueService.presets.map(\.id),
            ["classic", "retro-arcade", "bubble-pop", "sci-fi", "marimba", "playful-bounce", "robot", "gentle-chime", "typewriter", "coin-collect", "laser-zap", "whistle"]
        )
        XCTAssertEqual(Set(AudioCueService.presets.map(\.startCue)).count, AudioCueService.presets.count)
        XCTAssertEqual(Set(AudioCueService.presets.map(\.stopCue)).count, AudioCueService.presets.count)

        for preset in AudioCueService.presets {
            XCTAssertTrue(AudioCueSynthesizer.wav(preset.startCue).dropFirst(44).contains { $0 != 0 }, preset.id)
            XCTAssertTrue(AudioCueSynthesizer.wav(preset.stopCue).dropFirst(44).contains { $0 != 0 }, preset.id)
        }
    }

    @MainActor
    func testAudioCaptureReceivesFrameOffMainActor() async throws {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw XCTSkip("Microphone permission is required for the realtime tap regression test")
        }
        let frameReceived = expectation(description: "Audio frame received")
        frameReceived.assertForOverFulfill = false
        let capture = AudioCaptureService()

        try await capture.start(
            selectedDeviceUID: nil,
            onFrame: { _, _ in frameReceived.fulfill() },
            onLevel: { _ in }
        )
        await fulfillment(of: [frameReceived], timeout: 3)
        await capture.stop()
    }

    func testWAVEncoderWritesPCM16MonoHeader() {
        let pcm = Data([0x01, 0x02, 0x03, 0x04])
        let wav = WAVEncoder.pcm16Mono(pcm, sampleRate: 16_000)
        XCTAssertEqual(String(data: wav.prefix(4), encoding: .ascii), "RIFF")
        XCTAssertEqual(String(data: wav[8..<12], encoding: .ascii), "WAVE")
        XCTAssertEqual(String(data: wav[36..<40], encoding: .ascii), "data")
        XCTAssertEqual(wav.count, 44 + pcm.count)
        XCTAssertEqual(wav.suffix(pcm.count), pcm)
    }

    func testAudioLevelMappingRaisesSpeechAndReleasesSmoothly() {
        let speech = AudioCaptureService.normalizedLevel(rms: 0.03, previous: 0)
        let quieter = AudioCaptureService.normalizedLevel(rms: 0, previous: speech)

        XCTAssertGreaterThan(speech, 0.2)
        XCTAssertLessThan(speech, 1)
        XCTAssertGreaterThan(quieter, 0)
        XCTAssertLessThan(quieter, speech)
    }

    func testSpeechActivityGateRejectsSilenceAndShortNoise() {
        var gate = SpeechActivityGate()
        let silence = pcmFrame(amplitude: 0, milliseconds: 20)
        let noise = pcmFrame(amplitude: 6_000, milliseconds: 20)

        for _ in 0..<25 { _ = gate.consume(silence) }
        for _ in 0..<5 { _ = gate.consume(noise) }
        for _ in 0..<10 { _ = gate.consume(silence) }

        XCTAssertFalse(gate.speechDetectedEver)
    }

    func testSpeechActivityGateSettlesAmbientNoiseBeforeShowingSpeech() {
        var gate = SpeechActivityGate()
        let ambient = pcmFrame(amplitude: 300, milliseconds: 20)
        let speech = pcmFrame(amplitude: 6_000, milliseconds: 20)
        var result = gate.consume(ambient)

        for _ in 0..<50 { result = gate.consume(ambient) }
        let ambientLevel = result.visualLevel
        for _ in 0..<4 { result = gate.consume(speech) }

        XCTAssertLessThan(ambientLevel, 0.1)
        XCTAssertGreaterThan(result.visualLevel, ambientLevel + 0.3)
    }

    func testSpeechActivityGateDetectsSpeechAndKeepsPreRoll() {
        var gate = SpeechActivityGate()
        let silence = pcmFrame(amplitude: 0, milliseconds: 20)
        let speech = pcmFrame(amplitude: 8_000, milliseconds: 20)
        var recording = Data()

        for _ in 0..<20 {
            recording.append(silence)
            _ = gate.consume(silence)
        }
        for _ in 0..<15 {
            recording.append(speech)
            _ = gate.consume(speech)
        }
        for _ in 0..<25 {
            recording.append(silence)
            _ = gate.consume(silence)
        }

        let trimmed = gate.trimmed(recording)
        XCTAssertTrue(gate.speechDetectedEver)
        XCTAssertLessThan(trimmed.count, recording.count)
        XCTAssertGreaterThanOrEqual(trimmed.count, 15_000)
    }

    func testSpeechGateProcessesTenMinutesOfFramesWithinBudget() {
        var gate = SpeechActivityGate()
        let frame = pcmFrame(amplitude: 2_000, milliseconds: 20)
        let start = ContinuousClock.now
        for _ in 0..<30_000 { _ = gate.consume(frame) }
        let elapsed = start.duration(to: .now)

        XCTAssertLessThan(elapsed, .seconds(2))
    }

    func testObjCExceptionGuardCatchesRaisedException() {
        let error = ObjCExceptionGuard.run {
            NSException(
                name: .invalidArgumentException,
                reason: "required condition is false: format.sampleRate == hwFormat.sampleRate",
                userInfo: nil
            ).raise()
        }

        XCTAssertEqual(
            error?.localizedDescription,
            "required condition is false: format.sampleRate == hwFormat.sampleRate"
        )
    }

    func testObjCExceptionGuardReturnsNilWithoutException() {
        XCTAssertNil(ObjCExceptionGuard.run {})
    }

    private func pcmFrame(amplitude: Int16, milliseconds: Int) -> Data {
        let sampleCount = 16_000 * milliseconds / 1_000
        var samples = [Int16](repeating: amplitude, count: sampleCount)
        return samples.withUnsafeMutableBytes { Data($0) }
    }
}
