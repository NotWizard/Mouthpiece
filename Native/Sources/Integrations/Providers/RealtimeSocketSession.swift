import Foundation
import OSLog

// Shared plumbing for the realtime WebSocket providers (audit C5): the
// cold-start audio buffer, the finish/connect polling loop, and the benign
// post-termination closure policy that were previously copied per provider
// and had already drifted apart.
enum RealtimeSocketSession {
    // Audit P2-3: cold-start pending audio cap is tied to the connect
    // confirmation timeout each provider uses. Volcengine / Deepgram /
    // AssemblyAI / Soniox all wait up to 15 s for `connectionConfirmed`
    // (see each provider's `RealtimeSocketSession.waitForCondition(timeout:
    // .seconds(15), ...)` call), and Bailian's `createTask` allows 30 s
    // for `task-started`. Sizing the buffer to the same budget stops a
    // typical slow connect from silently truncating the beginning of the
    // recording; when the cap IS exceeded, `RealtimePendingAudioBuffer`
    // flips `leadingAudioDropped` so `finish()` can invalidate the
    // realtime transcript and let the coordinator's recovery ladder fall
    // back to batch/local with the full retained PCM.
    static let defaultConfirmationTimeoutSeconds = 15
    static let maximumPendingAudioBytes = pendingAudioCapacityBytes(
        confirmationTimeoutSeconds: defaultConfirmationTimeoutSeconds
    )

    // Audit P2-4: single canonical finalize budget every provider uses to
    // wait for its terminal message (`is_last_package` / `Termination` /
    // `finished`-close / `<fin>` endpoint / Bailian `task-finished`). When
    // the wait elapses without that signal, each `finish()` falls through
    // and returns the best available partial text — no throw, no hang.
    // Prior to this audit Bailian threw `BailianRealtimeError.timedOut` on
    // that path (dropping the tail entirely) and the magic `5` was copied
    // verbatim in every provider; centralising the constant here also
    // stops any provider from silently reverting to URLSession's ~60 s
    // default via the operating-system socket layer.
    static let defaultFinalizeTimeoutSeconds = 5

    // Central warning emitted by every provider's `finish()` when the
    // finalize wait falls through to best-partial. Kept in one place so
    // support logs and future breadcrumbs share one shape.
    static func logFinalizeTimeout(provider: String) {
        Logger(subsystem: "com.mouthpiece.app", category: "realtime")
            .warning(
                "\(provider, privacy: .public) finalize timed out after \(defaultFinalizeTimeoutSeconds, privacy: .public)s; returning best available partial."
            )
    }

    static func pendingAudioCapacityBytes(
        confirmationTimeoutSeconds: Int,
        sampleRate: Int = 16_000,
        bytesPerSample: Int = 2
    ) -> Int {
        max(1, confirmationTimeoutSeconds) * max(1, sampleRate) * max(1, bytesPerSample)
    }

    // Data(prefix)/Data(dropFirst) rebuild fresh zero-based Data: after
    // removeFirst, Data.startIndex is no longer 0, so zero-based
    // subdata/insert would trap on the next flush.
    static func detachSendableChunks(from buffer: inout Data, chunkBytes: Int) -> Data {
        let sendableCount = (buffer.count / chunkBytes) * chunkBytes
        guard sendableCount > 0 else { return Data() }
        let outgoing = Data(buffer.prefix(sendableCount))
        buffer = Data(buffer.dropFirst(sendableCount))
        return outgoing
    }

    // Audit C1 (provider side): once a session reached its terminal state,
    // the server tearing the socket down makes receive() throw; reporting
    // that closure as .error would fail an already-successful session.
    static func isBenignReceiveError(afterTerminalState reachedTerminalState: Bool) -> Bool {
        reachedTerminalState
    }

    // Polls actor state until the session reports a terminal condition, a
    // terminal error, or the deadline passes. Runs on the calling actor so
    // the closures may read actor-isolated state; each tick also runs
    // `onTick` (the providers' ensureCurrent staleness check). Returns
    // whether `isSatisfied` held when polling stopped.
    static func waitForCondition(
        isolation: isolated (any Actor)? = #isolation,
        timeout: Duration,
        pollInterval: Duration = .milliseconds(40),
        isSatisfied: () -> Bool,
        terminalError: () -> String?,
        onTick: () throws -> Void
    ) async throws -> Bool {
        let deadline = ContinuousClock.now + timeout
        while !isSatisfied(), terminalError() == nil, ContinuousClock.now < deadline {
            try await Task.sleep(for: pollInterval)
            try onTick()
        }
        return isSatisfied()
    }
}

// Frame-preserving cold-start buffer with a per-instance byte cap: frames
// queued before the socket is ready are kept whole and replayed in arrival
// order. When the cap is exceeded (indicating a truly stuck connect past
// the provider's confirmation timeout) the oldest frames are still dropped
// so memory stays bounded, but `leadingAudioDropped` flips to `true` — a
// signal `finish()` reads to invalidate the realtime transcript and let
// the coordinator fall back to batch/local (which still owns the full
// retained PCM). The flag intentionally survives `detachAll()` so a
// successful late connect + flush cannot mask the earlier truncation.
struct RealtimePendingAudioBuffer: Sendable {
    private var frames: [Data] = []
    private var byteCount = 0
    private let capacityBytes: Int
    private(set) var leadingAudioDropped = false

    init(capacityBytes: Int = RealtimeSocketSession.maximumPendingAudioBytes) {
        self.capacityBytes = max(1, capacityBytes)
    }

    mutating func append(_ data: Data) {
        guard !data.isEmpty else { return }
        frames.append(data)
        byteCount += data.count
        while byteCount > capacityBytes, !frames.isEmpty {
            byteCount -= frames.removeFirst().count
            leadingAudioDropped = true
        }
    }

    mutating func detachAll() -> [Data] {
        let detached = frames
        frames.removeAll()
        byteCount = 0
        // Note: leadingAudioDropped is intentionally *not* reset — finish()
        // must still be able to detect the cold-start truncation after the
        // eventual flush has drained the frames.
        return detached
    }
}

// Audit P2-3: signalled by every provider's `finish()` when the cold-start
// buffer truncated the leading audio during a stuck connect. Routing this
// through the existing throwing `finish()` -> coordinator catch path
// (DictationCoordinator.stop `realtimeError`) is enough: with the realtime
// text invalidated, the empty-transcript fallback ladder resurfaces the
// full retained PCM through batch/local transcription.
enum RealtimePendingAudioError: LocalizedError, Equatable {
    case leadingAudioDropped

    var errorDescription: String? {
        "Realtime connection took too long; leading audio was dropped and the realtime transcript is incomplete."
    }
}
