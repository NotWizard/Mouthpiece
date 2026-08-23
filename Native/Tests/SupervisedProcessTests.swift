import XCTest
@testable import Mouthpiece

/// Regression tests for the shared `SupervisedProcess` helper (audit P1-11 &
/// NEW-4). Both scenarios previously wedged the caller on HEAD:
///  - a SIGTERM-ignoring child blocked `Process.waitUntilExit()` forever
///    inside a Swift task group (P1-11: `LocalModelInstallationService`);
///  - a child writing >64 KB to stderr blocked on the pipe because the
///    caller never drained it (NEW-4: `AudioCueService.runAdapter`).
final class SupervisedProcessTests: XCTestCase {

    // A child that traps SIGTERM (so `process.terminate()` alone cannot
    // reap it) must be brought down by the SIGKILL escalation inside
    // roughly `timeout + killGrace`. Pre-fix `ProcessCommand.execute`
    // never sent SIGKILL, so the same child would keep the task group
    // alive indefinitely.
    func testTimeoutEscalatesToSIGKILLWhenChildIgnoresSIGTERM() async throws {
        // Use perl for the SIGTERM-ignoring child: it is guaranteed at a
        // fixed path on macOS and its `$SIG{TERM} = "IGNORE"` really does
        // ignore SIGTERM (unlike `/bin/sh` which can exec-optimise the
        // final command and lose the trap).
        let start = ContinuousClock.now
        let outcome = try await SupervisedProcess.run(
            executable: URL(fileURLWithPath: "/usr/bin/perl"),
            arguments: ["-e", "$SIG{TERM} = 'IGNORE'; sleep 30"],
            timeout: .milliseconds(200),
            killGrace: .milliseconds(200)
        )
        let elapsed = ContinuousClock.now - start
        XCTAssertEqual(outcome.termination, .terminatedByTimeout)
        // Wall-clock upper bound: timeout (0.2s) + killGrace (0.2s) + slack.
        // A hung waitUntilExit or missing SIGKILL would blow past this.
        XCTAssertLessThan(elapsed, .seconds(3))
    }

    // A child that writes ~700 KB to stderr must complete because
    // SupervisedProcess drains stderr continuously via readabilityHandler.
    // Pre-fix `AudioCueService.runAdapter` never touched the stderr pipe,
    // so the child blocked as soon as the ~64 KB kernel buffer filled and
    // was only released by the 2.5 s SIGTERM timeout.
    func testStderrIsDrainedAndNeverBlocksTheChild() async throws {
        let outcome = try await SupervisedProcess.run(
            executable: URL(fileURLWithPath: "/bin/sh"),
            arguments: [
                "-c",
                "yes xxxxxxx | head -c 716800 >&2; echo ok",
            ],
            timeout: .seconds(15)
        )
        XCTAssertEqual(outcome.termination, .exited(0))
        let stdout = String(data: outcome.stdout, encoding: .utf8) ?? ""
        XCTAssertTrue(stdout.contains("ok"), "stdout was: \(stdout)")
        // Cap defaults to 512 KiB; 700 KB > cap so we should hit exactly the
        // cap without losing data mid-stream (which would have blocked the
        // child pre-fix).
        XCTAssertEqual(outcome.stderr.count, 512 * 1024)
    }
}
