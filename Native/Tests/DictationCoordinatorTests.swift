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
        onLevel: @escaping @Sendable (Float) -> Void
    ) async throws {
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
    private(set) var sentFrameCount = 0
    private(set) var cancelCount = 0

    init(connect: ConnectBehavior, finishText: String = "") {
        connectBehavior = connect
        self.finishText = finishText
    }

    func setConnectBehavior(_ behavior: ConnectBehavior) {
        connectBehavior = behavior
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
        sentFrameCount += 1
    }

    func finish() async throws -> String { finishText }

    func cancel() async {
        cancelCount += 1
    }

    // Deliberately usable after cancel(): a real socket can deliver an
    // in-flight message after the session was abandoned.
    func emit(_ event: RealtimeTranscriptionEvent) {
        onEvent?(event)
    }
}
