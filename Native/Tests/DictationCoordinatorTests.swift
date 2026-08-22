import XCTest
@testable import Mouthpiece

// E4(1): DictationCoordinator orchestration against a scripted realtime
// provider and a stubbed microphone. The stubs replace only the hardware and
// network edges; state machine, keychain lookup, history persistence, and
// snapshot publishing run for real.
@MainActor
final class DictationCoordinatorTests: XCTestCase {
    func testConnectFailureFailsTheSessionAndAllowsARestart() async throws {
        let provider = ScriptedRealtimeProvider(connect: .fail("socket refused"))
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())

        let failure = harness.recorder.snapshots.first { $0.phase == .failed }
        XCTAssertNotNil(failure, "A realtime-only connect failure must surface a failed snapshot")
        XCTAssertEqual(failure?.errorMessage, "socket refused")
        let afterFailure = await harness.coordinator.snapshot()
        XCTAssertEqual(afterFailure.phase, .idle, "The failed session must reset back to idle")

        // The same coordinator must accept a fresh session once the provider recovers.
        await provider.setConnectBehavior(.succeed)
        await harness.coordinator.start(settings: makeSettings())
        let restarted = await harness.coordinator.snapshot()
        XCTAssertEqual(restarted.phase, .recording)
        await harness.coordinator.cancel()
    }

    func testStopUsesTheRealtimeTranscriptAndCompletesTheSession() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "hello from realtime")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let recording = await harness.coordinator.snapshot()
        XCTAssertEqual(recording.phase, .recording)

        // A captured frame must reach the provider through the consumer task.
        harness.audio.emitFrame()
        var frameForwarded = false
        for _ in 0..<200 {
            if await provider.sentFrameCount > 0 {
                frameForwarded = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(frameForwarded, "Audio frames must be forwarded to the realtime provider")

        // Partial events flow into the published snapshot while recording.
        await provider.emit(.partial(stable: "", active: "hello"))
        var partialSeen = false
        for _ in 0..<200 {
            if harness.recorder.snapshots.contains(where: { $0.partialText == "hello" }) {
                partialSeen = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(partialSeen, "Partial transcripts must be published while recording")

        await harness.coordinator.stop()

        XCTAssertTrue(harness.recorder.snapshots.contains { $0.phase == .completed })
        let finalSnapshot = await harness.coordinator.snapshot()
        XCTAssertEqual(finalSnapshot.phase, .idle, "A completed session must reset back to idle")
        let records = try await harness.history.recent(limit: 10)
        XCTAssertEqual(records.first?.text, "hello from realtime")
        XCTAssertEqual(records.first?.rawText, "hello from realtime")
    }

    func testCancelReturnsToIdleAndSuppressesLateProviderEvents() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "ignored")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let recording = await harness.coordinator.snapshot()
        XCTAssertEqual(recording.phase, .recording)

        await harness.coordinator.cancel()

        let cancelled = await harness.coordinator.snapshot()
        XCTAssertEqual(cancelled.phase, .idle)
        let providerCancelCount = await provider.cancelCount
        XCTAssertGreaterThanOrEqual(providerCancelCount, 1)

        // A late event from the abandoned session must not publish anything.
        let snapshotCount = harness.recorder.snapshots.count
        await provider.emit(.final("late text"))
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(harness.recorder.snapshots.count, snapshotCount)
        let finalSnapshot = await harness.coordinator.snapshot()
        XCTAssertEqual(finalSnapshot.phase, .idle)
        XCTAssertEqual(finalSnapshot.partialText, "")
    }

    // B2: frames yielded into the stream right before stop() must all reach
    // the provider before finish() is called; without the drain barrier
    // (finish the stream + await the consumer) tail frames raced the PCM
    // snapshot and could arrive after finalize or be lost entirely.
    func testStopDeliversAllQueuedFramesToTheProviderBeforeFinish() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "tail preserved")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let recording = await harness.coordinator.snapshot()
        XCTAssertEqual(recording.phase, .recording)

        // Prime the streaming path so the provider is known to receive frames.
        harness.audio.emitFrame()
        var frameForwarded = false
        for _ in 0..<200 {
            if await provider.sentFrameCount > 0 {
                frameForwarded = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(frameForwarded, "Audio frames must be forwarded to the realtime provider")

        // Enqueue three tail frames and stop immediately without yielding to
        // the consumer task: the barrier must deliver them before finalizing.
        harness.audio.emitFrame()
        harness.audio.emitFrame()
        harness.audio.emitFrame()
        await harness.coordinator.stop()

        let sentAtFinish = await provider.sentFrameCountAtFinish
        XCTAssertEqual(sentAtFinish, 4, "All queued tail frames must be sent before finish() is called")
        let sentTotal = await provider.sentFrameCount
        XCTAssertEqual(sentTotal, 4, "No frame may arrive at the provider after finish()")
        let records = try await harness.history.recent(limit: 5)
        XCTAssertEqual(records.first?.text, "tail preserved")
    }

    // B4: the translation hotkey now decides cancel-vs-start on the actor.
    // While a main session is recording, restartForTranslation must cancel it
    // and activate a fresh translation session.
    func testRestartForTranslationWhileRecordingCancelsAndActivatesTranslation() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "unused")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let mainSession = await harness.coordinator.snapshot()
        XCTAssertEqual(mainSession.phase, .recording)
        XCTAssertFalse(mainSession.isTranslation)

        var translationSettings = makeSettings()
        translationSettings.translationEnabled = true
        let activated = await harness.coordinator.restartForTranslation(settings: translationSettings)

        XCTAssertTrue(activated, "restartForTranslation must report the translation session as active")
        let restarted = await harness.coordinator.snapshot()
        XCTAssertEqual(restarted.phase, .recording)
        XCTAssertTrue(restarted.isTranslation)
        XCTAssertNotEqual(restarted.sessionID, mainSession.sessionID, "A fresh session must replace the cancelled one")
        let cancels = await provider.cancelCount
        XCTAssertGreaterThanOrEqual(cancels, 1, "The active main session must be cancelled before the restart")
        await harness.coordinator.cancel()
    }

    // B4: from idle the atomic restart must skip the cancel path and simply
    // start a translation session.
    func testRestartForTranslationFromIdleStartsDirectly() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "unused")
        let harness = try await makeHarness(provider: provider)

        var translationSettings = makeSettings()
        translationSettings.translationEnabled = true
        let activated = await harness.coordinator.restartForTranslation(settings: translationSettings)

        XCTAssertTrue(activated)
        let snapshot = await harness.coordinator.snapshot()
        XCTAssertEqual(snapshot.phase, .recording)
        XCTAssertTrue(snapshot.isTranslation)
        let cancels = await provider.cancelCount
        XCTAssertEqual(cancels, 0, "No session was active, so nothing must be cancelled")
        await harness.coordinator.cancel()
    }

    // The settle sleep inside restartForTranslation suspends the actor; a
    // queued main-hotkey start used to claim the session slot in that window
    // and turn the translation start into a silent no-op. The bounded retry
    // must cancel the stolen session and still activate translation.
    func testRestartForTranslationReclaimsSlotFromCompetingStart() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "unused")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let mainSession = await harness.coordinator.snapshot()
        XCTAssertEqual(mainSession.phase, .recording)

        var translationSettings = makeSettings()
        translationSettings.translationEnabled = true
        async let restart = harness.coordinator.restartForTranslation(settings: translationSettings)

        // Wait for the restart's cancel to land, then steal the freed slot
        // with a competing normal start while the restart is settling.
        var slotFreed = false
        for _ in 0..<200 {
            if await !harness.coordinator.snapshot().phase.isActive {
                slotFreed = true
                break
            }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTAssertTrue(slotFreed, "The restart must cancel the main session first")
        await harness.coordinator.start(settings: makeSettings())

        let activated = await restart
        XCTAssertTrue(activated, "The translation restart must reclaim the slot from the competing start")
        let snapshot = await harness.coordinator.snapshot()
        XCTAssertEqual(snapshot.phase, .recording)
        XCTAssertTrue(snapshot.isTranslation)
        await harness.coordinator.cancel()
    }

    // C1: a realtime-only provider error while recording must degrade the
    // connection instead of failing the session once a partial transcript
    // exists; stop() then completes with the retained partial.
    func testRealtimeErrorAfterPartialDegradesAndStopCompletesWithPartial() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "must not be used")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let startedPhase = await harness.coordinator.snapshot().phase
        XCTAssertEqual(startedPhase, .recording)

        await provider.emit(.partial(stable: "hello ", active: "world"))
        var partialSeen = false
        for _ in 0..<200 {
            if await harness.coordinator.snapshot().partialText == "hello world" {
                partialSeen = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(partialSeen, "The partial transcript must land before the error is injected")

        await provider.emit(.error("stream broke"))
        var degraded = false
        for _ in 0..<200 {
            if await provider.cancelCount >= 1 {
                degraded = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(degraded, "The broken provider task must be cancelled when degrading")
        let phaseAfterError = await harness.coordinator.snapshot().phase
        XCTAssertEqual(
            phaseAfterError,
            .recording,
            "An error with a retained partial must not fail the live session"
        )
        XCTAssertFalse(harness.recorder.snapshots.contains { $0.phase == .failed })

        await harness.coordinator.stop()

        XCTAssertTrue(harness.recorder.snapshots.contains { $0.phase == .completed })
        let finishCalls = await provider.finishCallCount
        XCTAssertEqual(finishCalls, 0, "A degraded provider must not be asked to finish")
        let records = try await harness.history.recent(limit: 5)
        XCTAssertEqual(records.first?.text, "hello world")
    }

    // C1: with no partial transcript there is nothing to salvage, so an early
    // realtime-only error must still fail the session immediately.
    func testEarlyRealtimeErrorWithoutPartialFailsTheSession() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "unused")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let earlyPhase = await harness.coordinator.snapshot().phase
        XCTAssertEqual(earlyPhase, .recording)

        await provider.emit(.error("early boom"))
        var failure: DictationSnapshot?
        for _ in 0..<200 {
            if let failed = harness.recorder.snapshots.first(where: { $0.phase == .failed }) {
                failure = failed
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNotNil(failure, "An early error without any partial transcript must fail the session")
        XCTAssertEqual(failure?.errorMessage, "early boom")
    }

    // C1: an error event that lands while stop() is already finalizing must
    // not interrupt the wind-down; finish() resolves the session on its own.
    func testRealtimeErrorDuringFinalizingDoesNotInterruptCompletion() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed, finishText: "final text")
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let liveRecordingPhase = await harness.coordinator.snapshot().phase
        XCTAssertEqual(liveRecordingPhase, .recording)

        await provider.blockFinish()
        let coordinator = harness.coordinator
        let stopTask = Task { await coordinator.stop() }
        var finishing = false
        for _ in 0..<200 {
            if await provider.finishCallCount > 0 {
                finishing = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(finishing, "stop() must reach the provider finish call while it is gated")

        await provider.emit(.error("mid-finalize boom"))
        // Give the queued error event time to reach the coordinator while the
        // session is still parked in finalizing, then let finish() resolve.
        try await Task.sleep(for: .milliseconds(150))
        await provider.releaseFinish()
        await stopTask.value

        XCTAssertFalse(
            harness.recorder.snapshots.contains { $0.phase == .failed },
            "An error during wind-down must not fail the finalizing session"
        )
        XCTAssertTrue(harness.recorder.snapshots.contains { $0.phase == .completed })
        let records = try await harness.history.recent(limit: 5)
        XCTAssertEqual(records.first?.text, "final text")
    }

    // A2: a realtime-only socket that dies during the stop drain must not fail
    // the session and wipe the captured audio — the retained partial has to
    // survive into history. Pre-fix the send catch called fail() ->
    // resetIfCurrent (pcm.removeAll) for realtime-only providers, so the
    // session ended .failed with nothing saved.
    func testSendFailureDuringStopKeepsPartialTranscript() async throws {
        let provider = ScriptedRealtimeProvider(connect: .succeed)
        let harness = try await makeHarness(provider: provider)

        await harness.coordinator.start(settings: makeSettings())
        let recording = await harness.coordinator.snapshot()
        XCTAssertEqual(recording.phase, .recording)

        await provider.emit(.partial(stable: "hello ", active: "world"))
        var partialSeen = false
        for _ in 0..<200 {
            if await harness.coordinator.snapshot().partialText == "hello world" {
                partialSeen = true
                break
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(partialSeen, "The partial transcript must land before the socket dies")

        // The socket dies during the stop drain: the queued tail frame's send
        // throws while the session is winding down.
        await provider.setShouldFailSend(true)
        harness.audio.emitFrame()
        await harness.coordinator.stop()

        XCTAssertFalse(
            harness.recorder.snapshots.contains { $0.phase == .failed },
            "A send failure with a retained partial must not fail the session"
        )
        XCTAssertTrue(harness.recorder.snapshots.contains { $0.phase == .completed })
        let finalSnapshot = await harness.coordinator.snapshot()
        XCTAssertEqual(finalSnapshot.phase, .idle, "A completed session must reset back to idle")
        let records = try await harness.history.recent(limit: 5)
        XCTAssertEqual(records.first?.text, "hello world")
    }

    // D8: the VoiceOver announcement mapping is a pure phase -> key table;
    // phases outside the announced set must stay silent (nil).
    func testCapsuleAnnouncementKeysCoverExactlyTheAnnouncedPhases() {
        XCTAssertEqual(CapsuleController.announcementKey(for: .recording), "capsule.listening")
        XCTAssertEqual(CapsuleController.announcementKey(for: .stopping), "capsule.transcribing")
        XCTAssertEqual(CapsuleController.announcementKey(for: .finalizing), "capsule.transcribing")
        XCTAssertEqual(CapsuleController.announcementKey(for: .completed), "capsule.success")
        XCTAssertEqual(CapsuleController.announcementKey(for: .failed), "capsule.failed")
        for silent in [DictationPhase.idle, .preparing, .processing, .inserting, .cancelled] {
            XCTAssertNil(CapsuleController.announcementKey(for: silent), "\(silent) must not announce")
        }
    }

    // MARK: - Harness

    private struct Harness {
        let coordinator: DictationCoordinator
        let audio: StubAudioCapture
        let recorder: SnapshotRecorder
        let history: HistoryRepository
    }

    private func makeSettings() -> AppSettings {
        var settings = AppSettings()
        // Bailian is realtime-only, so provider failures fail the session
        // instead of falling back to a batch upload.
        settings.cloudTranscriptionProvider = "bailian"
        settings.useLocalTranscription = false
        settings.useReasoningModel = false
        settings.translationEnabled = false
        settings.automaticallyPasteTranscription = false
        settings.keepTranscriptionInClipboard = false
        settings.pauseOtherMediaDuringDictation = false
        // The captured target is whatever app happens to be frontmost while
        // the suite runs; keep the sensitive-app guard out of these scenarios.
        settings.sensitiveAppProtectionEnabled = false
        return settings
    }

    private func makeHarness(provider: ScriptedRealtimeProvider) async throws -> Harness {
        // An isolated keychain service keeps the test key out of the real
        // "com.mouthpiece.app.credentials" service.
        let keychain = KeychainStore(service: "com.mouthpiece.app.tests.\(UUID().uuidString)")
        do {
            try await keychain.write("unit-test-key", for: .bailian)
        } catch KeychainError.unhandled(let status) {
            throw XCTSkip("The keychain is unavailable in this environment (OSStatus \(status)).")
        }
        addTeardownBlock { try? await keychain.delete(.bailian) }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-Coordinator-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let history = try HistoryRepository(
            databaseURL: directory.appendingPathComponent("history.sqlite3")
        )

        let audio = StubAudioCapture()
        let recorder = SnapshotRecorder()
        let coordinator = DictationCoordinator(
            audio: audio,
            history: history,
            keychain: keychain,
            logger: DebugLogStore(enabled: false),
            insertion: TextInsertionService(),
            capsule: CapsuleController(),
            reasoningService: ReasoningService(keychain: keychain),
            realtimeProviderOverride: provider,
            onSnapshot: { recorder.append($0) }
        )
        return Harness(coordinator: coordinator, audio: audio, recorder: recorder, history: history)
    }
}

@MainActor
private final class SnapshotRecorder {
    private(set) var snapshots: [DictationSnapshot] = []

    func append(_ snapshot: DictationSnapshot) { snapshots.append(snapshot) }
}

@MainActor
private final class StubAudioCapture: AudioCaptureService {
    private var frameSink: (@Sendable (Data, Double) -> Void)?

    override func requestPermission() async -> Bool { true }

    override func start(
        selectedDeviceUID: String?,
        onFrame: @escaping @Sendable (Data, Double) -> Void,
        onLevel: @escaping @Sendable (Float) -> Void,
        onSessionInterrupted: (@Sendable () -> Void)?,
        onDiagnostics: (@Sendable (Int) -> Void)?
    ) async throws {
        // The stub replaces only the hardware edge: it keeps the frame sink so
        // tests can inject PCM frames. The interruption and diagnostics hooks
        // are accepted (signature parity with the A1/A3 production API) but
        // never fired, because no real device exists in unit tests.
        frameSink = onFrame
    }

    override func stop() async {
        frameSink = nil
    }

    func emitFrame(byteCount: Int = 640, rms: Double = 0.02) {
        frameSink?(Data(repeating: 0, count: byteCount), rms)
    }
}

private actor ScriptedRealtimeProvider: RealtimeTranscriptionProvider {
    enum ConnectBehavior {
        case succeed
        case fail(String)
    }

    private var connectBehavior: ConnectBehavior
    private let finishText: String
    private var onEvent: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    // A2: simulates a socket that dies mid-stream so send() throws; defaults
    // off so existing scenarios are unaffected.
    private var shouldFailSend = false
    private(set) var sentFrameCount = 0
    private(set) var cancelCount = 0
    private(set) var finishCallCount = 0
    // Captured at the moment finish() is entered: proves whether every queued
    // frame was drained to the provider before finalization (B2).
    private(set) var sentFrameCountAtFinish: Int?
    private var finishBlocked = false
    private var finishGate: CheckedContinuation<Void, Never>?

    init(connect: ConnectBehavior, finishText: String = "") {
        connectBehavior = connect
        self.finishText = finishText
    }

    func setConnectBehavior(_ behavior: ConnectBehavior) {
        connectBehavior = behavior
    }

    func setShouldFailSend(_ value: Bool) {
        shouldFailSend = value
    }

    // Parks the next finish() call until releaseFinish(), so a test can hold
    // the coordinator in finalizing and inject events into that window.
    func blockFinish() {
        finishBlocked = true
    }

    func releaseFinish() {
        finishBlocked = false
        finishGate?.resume()
        finishGate = nil
    }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {}

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        switch connectBehavior {
        case .succeed:
            self.onEvent = onEvent
        case .fail(let message):
            throw BailianRealtimeError.protocolError(message)
        }
    }

    func send(pcm16: Data) async throws {
        if shouldFailSend {
            throw BailianRealtimeError.connectionLost("socket closed mid-stream")
        }
        sentFrameCount += 1
    }

    func finish() async throws -> String {
        finishCallCount += 1
        sentFrameCountAtFinish = sentFrameCount
        if finishBlocked {
            await withCheckedContinuation { continuation in
                finishGate = continuation
            }
        }
        return finishText
    }

    func cancel() async {
        cancelCount += 1
    }

    // Deliberately usable after cancel(): a real socket can deliver an
    // in-flight message after the session was abandoned.
    func emit(_ event: RealtimeTranscriptionEvent) {
        onEvent?(event)
    }
}
