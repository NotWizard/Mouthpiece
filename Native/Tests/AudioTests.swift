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
    func testAudioCueSynthesisIsDeterministicSoCachedCuesMatchFreshRenders() {
        // AudioCueService now renders each preset once into a static cache;
        // that is only sound if a second render yields identical bytes,
        // including the seeded-noise presets like "typewriter".
        for preset in AudioCueService.presets {
            let start = AudioCueSynthesizer.wav(preset.startCue)
            let stop = AudioCueSynthesizer.wav(preset.stopCue)
            XCTAssertEqual(start, AudioCueSynthesizer.wav(preset.startCue), preset.id)
            XCTAssertEqual(stop, AudioCueSynthesizer.wav(preset.stopCue), preset.id)
            XCTAssertGreaterThan(start.count, 44, preset.id)
            XCTAssertGreaterThan(stop.count, 44, preset.id)
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

    // 2026-09-06 main-thread freeze: replacing the engine deallocated the old
    // one on the main actor, and AVAudioEngine.dealloc blocks on a wedged
    // HAL. The retired engine must now be released asynchronously on
    // engineQueue — replacement happens, nothing leaks, and a fresh session
    // still captures after the swap.
    @MainActor
    func testStartRetiresPreviousEngineWithoutLeakingIt() async throws {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
            throw XCTSkip("Microphone permission is required for the engine retirement regression test")
        }
        let capture = AudioCaptureService()
        try await capture.start(selectedDeviceUID: nil, onFrame: { _, _ in }, onLevel: nil)
        weak var retired = capture.testEngineHandle
        let retiredID = ObjectIdentifier(capture.testEngineHandle)
        await capture.stop()

        try await capture.start(selectedDeviceUID: nil, onFrame: { _, _ in }, onLevel: nil)
        XCTAssertNotEqual(ObjectIdentifier(capture.testEngineHandle), retiredID)
        await capture.stop()

        // The retired engine's last reference rides the retire block on
        // engineQueue; once the queue drains, the weak probe must be nil.
        var released = false
        for _ in 0..<100 {
            if retired == nil {
                released = true
                break
            }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTAssertTrue(released, "The retired engine must be released after replacement")
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

    // A1: multi-sentence dictation used to return only the last sentence. The
    // gate falls back to .idle after 320ms of silence (any normal pause), and
    // reopening it rewrote the trim onset to the latest burst, discarding every
    // earlier utterance. trimmed() must keep first-onset..last-offset across a
    // long inter-sentence pause.
    func testTrimmedKeepsFirstUtteranceAcrossLongPause() {
        var gate = SpeechActivityGate()
        let silence = pcmFrame(amplitude: 0, milliseconds: 20)
        let speech = pcmFrame(amplitude: 8_000, milliseconds: 20)
        let frameBytes = speech.count // 640 bytes = 20 ms of 16 kHz PCM16
        var recording = Data()

        // Settle, then burst 1.
        for _ in 0..<20 {
            recording.append(silence)
            _ = gate.consume(silence)
        }
        for _ in 0..<15 {
            recording.append(speech)
            _ = gate.consume(speech)
        }
        // 400 ms of silence exceeds the 320 ms hangover, so the gate returns to
        // .idle and must reopen for burst 2 — the condition that used to drop
        // burst 1 by overwriting the trim onset.
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

        // Span from burst 1's onset to burst 2's last offset within `recording`.
        // The fixed gate keeps this whole span (plus pre-roll and tail); the
        // buggy gate trimmed from burst 2's onset, so its output is shorter than
        // this span and excludes burst 1 entirely.
        let firstOnset = 20 * frameBytes
        let lastOffset = (20 + 15 + 20 + 15) * frameBytes
        let firstToLastSpan = lastOffset - firstOnset

        XCTAssertTrue(gate.speechDetectedEver)
        XCTAssertLessThan(trimmed.count, recording.count)
        XCTAssertGreaterThan(trimmed.count, firstToLastSpan)
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

    // A2/A3: the tap is installed with a nil format, so a device switch
    // changes the buffer format mid-session. The converter pool must rebuild
    // for the new format and keep emitting 20 ms 16 kHz frames instead of
    // dropping audio; a clean run must not invoke the dropped-frame
    // diagnostics callback.
    func testConverterPoolRebuildsOnMidSessionFormatChangeWithoutDroppingAudio() async throws {
        let sink = ConverterFrameSink()
        let box = try AudioConverterBox(
            onFrame: { data, _ in sink.append(data) },
            onLevel: { _ in },
            onDiagnostics: { sink.recordDropped($0) }
        )

        box.process(try makeSineBuffer(sampleRate: 48_000, frames: 4_800))
        box.process(try makeSineBuffer(sampleRate: 24_000, frames: 2_400))
        await box.finish()

        XCTAssertNil(sink.dropped, "No frame may be reported dropped in a clean two-format run")
        let frames = sink.frames
        XCTAssertFalse(frames.isEmpty)
        for frame in frames.dropLast() {
            XCTAssertEqual(frame.count, 640, "Full frames must stay 20 ms of 16 kHz PCM16")
        }
        // 100 ms at 48 kHz plus 100 ms at 24 kHz both resample to 16 kHz:
        // ~6400 output bytes. Requiring > 5000 proves audio recorded after
        // the format switch was converted too (one segment alone tops out at
        // 3200 bytes); the tolerance absorbs resampler priming latency.
        let totalBytes = frames.reduce(0) { $0 + $1.count }
        XCTAssertGreaterThan(totalBytes, 5_000)
        XCTAssertLessThanOrEqual(totalBytes, 7_040)
    }

    // P2-20: `startEngineSession` now prewarms the converter's buffer pool
    // BEFORE installing the render tap, so CoreAudio's realtime thread never
    // executes the reactive `availableBuffers = (0..<10).compactMap {...}`
    // allocation while holding `lock` on the normal path. This asserts the
    // seam on both branches: a non-prewarmed box still bumps the counter on
    // its first buffer (proving the counter fires when it should); a
    // prewarmed box feeding a burst of same-format buffers keeps the counter
    // at 0.
    func testBufferPoolPrewarmedNoAllocUnderLock() async throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1))

        // Positive control: without prewarm, the first buffer of a session
        // must land in the reactive branch (previous production behaviour),
        // so the counter proves the seam actually fires when it should.
        let cold = try AudioConverterBox(onFrame: { _, _ in }, onLevel: { _ in })
        cold.process(try makeSineBuffer(sampleRate: 48_000, frames: 480))
        await cold.finish()
        XCTAssertEqual(
            cold.allocationsUnderLock, 1,
            "Non-prewarmed box must allocate under lock on the first buffer"
        )

        // Primary regression: prewarm mirrors what `startEngineSession` now
        // does, and every subsequent same-format render call reuses the pool.
        let warm = try AudioConverterBox(onFrame: { _, _ in }, onLevel: { _ in })
        warm.prewarm(for: format)
        for _ in 0..<20 {
            warm.process(try makeSineBuffer(sampleRate: 48_000, frames: 480))
        }
        await warm.finish()
        XCTAssertEqual(
            warm.allocationsUnderLock, 0,
            "Prewarmed pool must not allocate under lock on the render path"
        )
    }

    // P3-7: `AudioConverterBox.emit` used to compute the smoothed audio level
    // (log10 + exponential smoothing) and fire `onLevel` on EVERY ~20 ms frame,
    // even for the dictation session whose call site passed `onLevel: { _ in }`
    // — pure wasted work ~50x/second. `onLevel` is now optional and the
    // dictation path passes nil, so the whole computation is gated on a real
    // consumer. This pins both branches: a nil callback must skip the
    // computation (the counter stays 0), while a real callback must run it and
    // receive one level per computed frame (the onboarding mic test's path).
    func testOnLevelSkippedWhenCallbackAbsent() async throws {
        let silent = try AudioConverterBox(onFrame: { _, _ in }, onLevel: nil)
        for _ in 0..<3 {
            silent.process(try makeSineBuffer(sampleRate: 48_000, frames: 4_800))
        }
        await silent.finish()
        XCTAssertEqual(
            silent.levelComputations, 0,
            "A nil onLevel must skip the per-frame smoothed-level computation entirely"
        )

        let levels = LevelSink()
        let metered = try AudioConverterBox(
            onFrame: { _, _ in },
            onLevel: { levels.record($0) }
        )
        for _ in 0..<3 {
            metered.process(try makeSineBuffer(sampleRate: 48_000, frames: 4_800))
        }
        await metered.finish()
        XCTAssertGreaterThan(
            metered.levelComputations, 0,
            "A real onLevel must compute the smoothed level per frame"
        )
        XCTAssertEqual(
            levels.count, metered.levelComputations,
            "Every computed level must be delivered to the onLevel callback"
        )
    }

    private func makeSineBuffer(sampleRate: Double, frames: AVAudioFrameCount) throws -> AVAudioPCMBuffer {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1))
        let buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames))
        buffer.frameLength = frames
        let channel = try XCTUnwrap(buffer.floatChannelData?[0])
        for index in 0..<Int(frames) {
            channel[index] = sinf(Float(index) * 2 * .pi * 440 / Float(sampleRate)) * 0.25
        }
        return buffer
    }

    private func pcmFrame(amplitude: Int16, milliseconds: Int) -> Data {
        let sampleCount = 16_000 * milliseconds / 1_000
        var samples = [Int16](repeating: amplitude, count: sampleCount)
        return samples.withUnsafeMutableBytes { Data($0) }
    }
}

// Collects converter output across the conversion queue; finish() drains the
// queue before returning, so reads after `await finish()` see the final state.
private final class ConverterFrameSink: @unchecked Sendable {
    private let lock = NSLock()
    private var storedFrames: [Data] = []
    private var storedDropped: Int?

    var frames: [Data] { lock.withLock { storedFrames } }
    var dropped: Int? { lock.withLock { storedDropped } }

    func append(_ frame: Data) {
        lock.withLock { storedFrames.append(frame) }
    }

    func recordDropped(_ count: Int) {
        lock.withLock { storedDropped = count }
    }
}

// P3-7: collects `onLevel` callbacks across the conversion queue. finish()
// drains the queue before returning, so reads after `await finish()` see the
// final count.
private final class LevelSink: @unchecked Sendable {
    private let lock = NSLock()
    private var levels: [Float] = []

    var count: Int { lock.withLock { levels.count } }

    func record(_ level: Float) {
        lock.withLock { levels.append(level) }
    }
}
