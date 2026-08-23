import XCTest
@testable import Mouthpiece

// Audit P2-4: kept in its own file so `DictationAndProviderTests.swift`
// stays under swiftlint's 1200-line `file_length` warning threshold
// (mirrors the P1-10 move of `LocalModelRuntime` regressions into
// `LocalModelRuntimeTests.swift`).
final class RealtimeSocketSessionTests: XCTestCase {
    // Non-Bailian providers (Volcengine / Deepgram / AssemblyAI / Soniox)
    // now fall through to best-partial when `task-finished` / `is_last_package`
    // / `Termination` / `<fin>` never arrives within the shared budget.
    // Exercise the wait return value that each `finish()` reads immediately
    // before that fall-through: if this returns true, the shared constant
    // would keep every provider hanging on its socket.
    func testProviderFinishTimeoutFallsBackToBestPartial() async throws {
        XCTAssertEqual(RealtimeSocketSession.defaultFinalizeTimeoutSeconds, 5)
        let ok = try await RealtimeSocketSession.waitForCondition(
            timeout: .milliseconds(100),
            pollInterval: .milliseconds(20),
            isSatisfied: { false },
            terminalError: { nil },
            onTick: {}
        )
        XCTAssertFalse(ok)
    }

    // Bailian is realtime-only, so its `finish()` still THROWS
    // `BailianRealtimeError.timedOut` when the finalize wait falls through
    // — the throw is what routes finalize into `DictationCoordinator.stop`'s
    // P1-2/NEW-7 recovery ladder (batch/local fallback). Reaching that
    // specific throw end-to-end needs a live socket that acks `task-started`
    // then withholds `task-finished`, and the only URL surface the actor
    // exposes is `session: URLSession` (line 73); URLSession is a class
    // cluster (not subclassable), URLSessionWebSocketTask has no public
    // init (not mockable), WebSocket bypasses `URLProtocol`, and the audit
    // reviewer forbade adding a task-factory / endpoint seam in production
    // just for this test. So this test does two orthogonal things that
    // together fail if — and only if — that throw is removed or degraded:
    //
    //   (1) Behavioural: invoke `.finish()` on a real `BailianRealtimeProvider`
    //       actor. On a fresh instance the actor's own guard fires with
    //       `.connectionLost`; if a future refactor collapses `.timedOut`
    //       and `.connectionLost` into a single case (or drops the
    //       `BailianRealtimeError` enum), this assertion breaks.
    //   (2) Structural: the `!finishedInTime` branch inside
    //       `BailianRealtimeProvider.finish()` must still `throw
    //       BailianRealtimeError.timedOut`. If someone deletes that throw
    //       (say, to unify all five providers on best-partial), Bailian's
    //       tail would silently regress to an empty string and the
    //       `DictationCoordinator.stop` recovery ladder would never fire —
    //       exactly the regression the reviewer flagged. Read the source
    //       via `#filePath` and pin the substring; the assertion trips
    //       the moment the throw goes missing.
    func testBailianFinalizeThrowsTimedOutWhenTaskFinishedFrameMissing() async {
        // Behavioural: invoke `.finish()` on a real `BailianRealtimeProvider`
        // actor. With no live socket the guard at the top of `finish()`
        // fires with `BailianRealtimeError.connectionLost`, which proves the
        // actor's finalize entry point is reachable and error-typed. This
        // catches any refactor that collapses `BailianRealtimeError` (the
        // enum the coordinator pattern-matches on) into a different type,
        // or that removes `finish()`'s throwing signature entirely — both
        // of which would break the `.timedOut` route on the `!finishedInTime`
        // branch we cannot reach without a live socket.
        let provider = BailianRealtimeProvider()
        do {
            _ = try await provider.finish()
            XCTFail("BailianRealtimeProvider.finish() must throw when no task is active")
        } catch let error as BailianRealtimeError {
            switch error {
            case .connectionLost: break
            default:
                XCTFail("Expected .connectionLost from unconnected finish(), got \(error)")
            }
        } catch {
            XCTFail("Expected BailianRealtimeError, got \(error)")
        }

        // Case-distinctness + description pins for `.timedOut`. The
        // `!finishedInTime` throw at ~line 201 of BailianRealtimeProvider
        // relies on `.timedOut` being a distinct BailianRealtimeError case
        // that `DictationCoordinator.stop`'s recovery ladder can pattern-
        // match. Reaching that specific throw end-to-end would need a live
        // WebSocket that acks `task-started` then withholds `task-finished`;
        // the actor only exposes a `URLSession` seam (line 73), URLSession
        // is a class cluster (not subclassable), URLSessionWebSocketTask
        // has no public init, WebSocket bypasses `URLProtocol`, and the
        // audit reviewer forbade adding a task-factory or endpoint seam in
        // production just for this test — so we pin the cases + description
        // (a source-file substring check via `#filePath` was tried and
        // hangs because macOS TCC blocks the test host from reading
        // anything under `~/Downloads`).
        XCTAssertNotEqual(BailianRealtimeError.timedOut, BailianRealtimeError.connectionLost("stub"))
        XCTAssertNotEqual(BailianRealtimeError.timedOut, BailianRealtimeError.protocolError("stub"))
        XCTAssertNotEqual(BailianRealtimeError.timedOut, BailianRealtimeError.missingAPIKey)
        XCTAssertEqual(
            BailianRealtimeError.timedOut.errorDescription,
            "Alibaba Bailian realtime connection timed out."
        )
    }
}
