import Foundation

// Reasoning-step helpers extracted from the DictationCoordinator actor body so
// its type_body_length stays under the SwiftLint threshold, mirroring the
// existing P2-1/P2-2 extractions. Both are static: reasoningWithTimeout only
// needs the caller's Task, and logReasoning takes the logger explicitly so this
// extension does not reach for the actor's private stored properties.
extension DictationCoordinator {
    // Cloud cleanup on DashScope has a long latency tail; bound it so a slow
    // reasoning call falls back to the raw transcript instead of stalling
    // finalize for the full request timeout. Races the already-created task
    // (so stop() keeps the reasoningTask handle for cancel-on-supersede)
    // against the deadline; on timeout the task is cancelled and
    // finalizeTimedOut is thrown, which stop()'s catch routes to the raw
    // transcript. A task that finishes first wins and the sleep is cancelled.
    static func reasoningWithTimeout(
        _ task: Task<String, Error>,
        timeout: Duration = .seconds(8)
    ) async throws -> String {
        try await withThrowingTaskGroup(of: String?.self) { group in
            group.addTask { try await task.value }
            group.addTask {
                try? await Task.sleep(for: timeout)
                return nil
            }
            defer { group.cancelAll() }
            while let result = try await group.next() {
                if let text = result { return text }
                task.cancel()
                throw DictationSessionError.finalizeTimedOut
            }
            throw DictationSessionError.finalizeTimedOut
        }
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
