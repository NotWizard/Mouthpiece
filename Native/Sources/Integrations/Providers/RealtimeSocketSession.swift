import Foundation

// Shared plumbing for the realtime WebSocket providers (audit C5): the
// cold-start audio buffer, the finish/connect polling loop, and the benign
// post-termination closure policy that were previously copied per provider
// and had already drifted apart.
enum RealtimeSocketSession {
    // Cold-start buffer cap shared by every provider: three seconds of
    // 16 kHz mono PCM16 (Deepgram previously inlined the same 96 000).
    static let maximumPendingAudioBytes = 3 * 16_000 * 2

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

// Frame-preserving cold-start buffer with the shared byte cap: frames queued
// before the socket is ready are kept whole and replayed in arrival order.
struct RealtimePendingAudioBuffer: Sendable {
    private var frames: [Data] = []
    private var byteCount = 0

    mutating func append(_ data: Data) {
        guard !data.isEmpty else { return }
        frames.append(data)
        byteCount += data.count
        while byteCount > RealtimeSocketSession.maximumPendingAudioBytes, !frames.isEmpty {
            byteCount -= frames.removeFirst().count
        }
    }

    mutating func detachAll() -> [Data] {
        let detached = frames
        frames.removeAll()
        byteCount = 0
        return detached
    }
}
