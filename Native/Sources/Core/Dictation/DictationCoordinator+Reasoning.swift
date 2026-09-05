import Foundation

// F4: race gate for the reasoning deadline. One resolution wins — model
// result, deadline, or caller cancellation — and tears the losers down
// without ever awaiting an uncooperative operation task. The pendingResult
// slot covers the register-after-resolve race (an operation that finishes
// before install, or cancellation landing before the continuation exists).
private final class ReasoningTimeoutGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<String, Error>?
    private var teardown: (() -> Void)?
    private var pendingResult: Result<String, Error>?
    private var resolved = false

    // Called once from the continuation body; if the race already resolved,
    // resumes immediately with the stored result.
    func install(
        _ continuation: CheckedContinuation<String, Error>,
        teardown: @escaping () -> Void
    ) {
        lock.lock()
        if let pendingResult {
            self.pendingResult = nil
            lock.unlock()
            teardown()
            continuation.resume(with: pendingResult)
            return
        }
        self.continuation = continuation
        self.teardown = teardown
        lock.unlock()
    }

    // First call wins: losers are cancelled via teardown and never resume.
    func resolve(_ result: Result<String, Error>) {
        lock.lock()
        if resolved { lock.unlock(); return }
        resolved = true
        let continuation = self.continuation
        let teardown = self.teardown
        self.continuation = nil
        self.teardown = nil
        if continuation == nil { pendingResult = result }
        lock.unlock()
        teardown?()
        continuation?.resume(with: result)
    }
}

// Reasoning-step helpers extracted from the DictationCoordinator actor body so
// its type_body_length stays under the SwiftLint threshold, mirroring the
// existing P2-1/P2-2 extractions. All helpers are static and take their inputs
// explicitly so this extension never reaches for the actor's private stored
// properties from another file.
extension DictationCoordinator {
    // Cloud cleanup on DashScope has a long latency tail; bound it so a slow
    // reasoning call falls back to the raw transcript instead of stalling
    // finalize for the full request timeout. F4: the previous task-group race
    // returned only after EVERY child exited, so an operation ignoring
    // cancellation held the deadline hostage. Now the first of operation /
    // deadline / caller-cancellation claims the gate and tears the losers
    // down; the winner resumes the continuation exactly once, so the deadline
    // is real even when the underlying task never cooperates.
    static func reasoningWithTimeout(
        _ task: Task<String, Error>,
        timeout: Duration = .seconds(8)
    ) async throws -> String {
        let gate = ReasoningTimeoutGate()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
                let timer = Task {
                    try? await Task.sleep(for: timeout)
                    // A cancelled sleep lands here too, but by then the gate
                    // already has a winner, so this resolve is a no-op.
                    gate.resolve(.failure(DictationSessionError.finalizeTimedOut))
                }
                let observer = Task {
                    do {
                        gate.resolve(.success(try await task.value))
                    } catch {
                        gate.resolve(.failure(error))
                    }
                }
                gate.install(continuation) {
                    task.cancel()
                    timer.cancel()
                    observer.cancel()
                }
            }
        } onCancel: {
            gate.resolve(.failure(CancellationError()))
        }
    }

    // F4: the handle the coordinator stores for cancel()/shutdown() is this
    // bounded wrapper, not the raw operation — cancelling the wrapper fires
    // the cancellation handler above, which cancels the operation AND the
    // timer even when the operation itself ignores cancellation.
    static func startBoundedReasoning(
        service: ReasoningService,
        text: String,
        settings: AppSettings,
        target: TextInsertionTarget?
) -> Task<String, Error> {
        let operation = Task { try await service.process(text, settings: settings, target: target) }
        return Task { try await reasoningWithTimeout(operation) }
    }

    // Attribution for the cloud cleanup step so latency spikes and thinking-on
    // regressions are diagnosable from the debug log. No-op when cleanup was
    // skipped (willProcess == false). Records counts and flags only — never the
    // transcript text, so a sensitive session leaks nothing through this sink.
    static func logReasoning(
        _ logger: DebugLogStore,
        willProcess: Bool,
        startedAt: Date,
        settings: AppSettings,
        rawText: String,
        result: String?,
        error: Error?,
        sessionID: UUID
    ) async {
        guard willProcess else { return }
        let outcome: String
        if error == nil {
            outcome = "ok"
        } else if (error as? DictationSessionError) == .finalizeTimedOut {
            outcome = "timeout"
        } else {
            outcome = "error"
        }
        var metadata: [String: String] = [
            "provider": settings.reasoningProvider,
            "model": settings.reasoningModel.isEmpty ? "(default)" : settings.reasoningModel,
            "outcome": outcome,
            "elapsedMs": String(Int(Date().timeIntervalSince(startedAt) * 1_000)),
            "rawChars": String(rawText.count),
            "translation": String(settings.translationEnabled),
        ]
        if let enableThinking = ReasoningService.resolvedEnableThinking(
            provider: settings.reasoningProvider,
            settings: settings
        ) {
            metadata["enableThinking"] = String(enableThinking)
        }
        if let result { metadata["resultChars"] = String(result.count) }
        if let error { metadata["error"] = error.localizedDescription }
        await logger.write(.debug, "Text processing finished", metadata: metadata, sessionID: sessionID)
    }
}
