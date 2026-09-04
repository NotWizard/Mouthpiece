import Foundation

// Preparing-step diagnostics extracted from the DictationCoordinator actor
// body so its file_length stays under the SwiftLint threshold, mirroring the
// DictationCoordinator+Reasoning extraction. Helpers are static and take the
// logger explicitly because this extension cannot reach the actor's private
// stored properties from another file.
extension DictationCoordinator {
    // Each begin/end pair brackets one suspension point in start() that can
    // stall on a wedged system service (audio HAL after sleep/wake, securityd,
    // the realtime handshake). After a preparing hang, the last log entry
    // names the step that never completed. Steps never carry credentials or
    // transcript text.
    static func logPreparingStep(_ step: String, logger: DebugLogStore, sessionID: UUID) async {
        await logger.write(.debug, "Dictation preparing step", metadata: ["step": step], sessionID: sessionID)
    }

    // Written at fail() entry, before any teardown await: if a wedged service
    // blocks the cleanup path, this entry still proves the preparing watchdog
    // (or another fail caller) actually fired. The existing
    // "Dictation session failed" entry then marks cleanup completion.
    static func logFailEntry(_ error: Error, logger: DebugLogStore, sessionID: UUID) async {
        await logger.write(
            .error,
            "Dictation session failing",
            metadata: ["error": error.localizedDescription],
            sessionID: sessionID
        )
    }
}
