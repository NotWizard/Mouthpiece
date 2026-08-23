import Darwin
import Foundation

/// Runs an external `Process` with a total wall-clock timeout, cooperative
/// cancellation, and non-deadlocking stdout/stderr drainage.
///
/// Contract:
///  - Never calls `Process.waitUntilExit()` inside a Swift `Task` (that
///    blocks the cooperative pool). Completion is signalled through
///    `Process.terminationHandler` bridged to an async waiter.
///  - Stdout and stderr are drained continuously via `Pipe.readabilityHandler`
///    so a child writing beyond the ~64 KB kernel pipe buffer cannot block.
///  - Captured bytes are capped per stream (default 512 KB) so error paths
///    can show a snippet without unbounded memory.
///  - On wall-clock timeout OR outer `Task` cancellation: send SIGTERM,
///    wait up to `killGrace`, then send SIGKILL if the child is still alive.
///    The call always returns — a SIGTERM-ignoring child cannot wedge us.
enum SupervisedProcess {

    enum Termination: Sendable, Equatable {
        case exited(Int32)
        case terminatedByTimeout
        case terminatedByCancellation
    }

    struct Outcome: Sendable {
        let termination: Termination
        let stdout: Data
        let stderr: Data
    }

    /// Launch failure (executable missing, permission denied, etc.). All
    /// post-launch outcomes surface through `Outcome`.
    struct LaunchError: Error {
        let underlying: any Error
    }

    static func run(
        executable: URL,
        arguments: [String],
        environment: [String: String]? = nil,
        timeout: Duration,
        killGrace: Duration = .milliseconds(500),
        stdoutCapBytes: Int = 512 * 1024,
        stderrCapBytes: Int = 512 * 1024
    ) async throws -> Outcome {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = environment

        let stdoutSink = ByteSink(cap: stdoutCapBytes)
        let stderrSink = ByteSink(cap: stderrCapBytes)
        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        // readabilityHandler runs on a Foundation-owned queue. It ALWAYS reads
        // `availableData` so the child's write end never fills, regardless of
        // whether the caller-provided cap has been reached.
        stdoutPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
            } else {
                stdoutSink.append(data)
            }
        }
        stderrPipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
            } else {
                stderrSink.append(data)
            }
        }

        let waiter = TerminationWaiter()
        process.terminationHandler = { _ in
            waiter.signal()
        }

        do {
            try process.run()
        } catch {
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            throw LaunchError(underlying: error)
        }

        let handle = ProcessHandle(process: process)
        let pid = process.processIdentifier

        let termination = await withTaskCancellationHandler {
            await race(
                handle: handle,
                pid: pid,
                waiter: waiter,
                timeout: timeout,
                killGrace: killGrace
            )
        } onCancel: {
            // Best-effort synchronous SIGTERM; the racing timeout task will
            // observe cancellation and escalate to SIGKILL after killGrace.
            handle.terminateIfRunning()
        }

        // terminationHandler has fired; the readabilityHandler EOF callbacks
        // may still be in flight but any pending bytes were already drained.
        // Belt-and-braces detach the handlers so the pipes can close.
        stdoutPipe.fileHandleForReading.readabilityHandler = nil
        stderrPipe.fileHandleForReading.readabilityHandler = nil

        return Outcome(
            termination: termination,
            stdout: stdoutSink.snapshot(),
            stderr: stderrSink.snapshot()
        )
    }

    private static func race(
        handle: ProcessHandle,
        pid: pid_t,
        waiter: TerminationWaiter,
        timeout: Duration,
        killGrace: Duration
    ) async -> Termination {
        // Single event source: whichever of (natural exit, wall-clock timeout,
        // cooperative cancellation) fires first decides the Termination.
        // Splitting this across two tasks races on the terminationHandler
        // itself once we escalate — Task A would report .exited before
        // Task B could report .terminatedByTimeout.
        let event = await raceEvent(waiter: waiter, timeout: timeout)
        switch event {
        case .processExited:
            return .exited(handle.terminationStatus)
        case .timeout:
            await escalate(handle: handle, pid: pid, waiter: waiter, killGrace: killGrace)
            return .terminatedByTimeout
        case .cancelled:
            await escalate(handle: handle, pid: pid, waiter: waiter, killGrace: killGrace)
            return .terminatedByCancellation
        }
    }

    private enum RaceEvent: Sendable {
        case processExited
        case timeout
        case cancelled
    }

    private static func raceEvent(
        waiter: TerminationWaiter,
        timeout: Duration
    ) async -> RaceEvent {
        await withTaskGroup(of: RaceEvent.self, returning: RaceEvent.self) { group in
            group.addTask {
                let signalled = await waiter.wait()
                return signalled ? .processExited : .cancelled
            }
            group.addTask {
                do {
                    try await Task.sleep(for: timeout)
                    return .timeout
                } catch {
                    return .cancelled
                }
            }
            let first = await group.next() ?? .processExited
            group.cancelAll()
            for await _ in group {}
            return first
        }
    }

    /// SIGTERM the child, wait up to `killGrace` for it to exit, then SIGKILL
    /// if still alive. Blocks (asynchronously) until the child is truly dead.
    private static func escalate(
        handle: ProcessHandle,
        pid: pid_t,
        waiter: TerminationWaiter,
        killGrace: Duration
    ) async {
        guard handle.isRunning else { return }
        handle.terminate()
        await withTaskGroup(of: Void.self) { grace in
            grace.addTask { await waiter.wait() }
            grace.addTask { try? await Task.sleep(for: killGrace) }
            _ = await grace.next()
            grace.cancelAll()
            for await _ in grace {}
        }
        if handle.isRunning {
            Darwin.kill(pid, SIGKILL)
            await waiter.wait()
        }
    }
}

// MARK: - Sendable helpers

/// Reference wrapper so a non-Sendable `Process` may cross into `@Sendable`
/// closures. Only invokes methods that are safe to call from any thread:
/// `isRunning`, `terminationStatus`, `terminate`.
private struct ProcessHandle: @unchecked Sendable {
    let process: Process
    var isRunning: Bool { process.isRunning }
    var terminationStatus: Int32 { process.terminationStatus }
    func terminate() { process.terminate() }
    func terminateIfRunning() {
        if process.isRunning { process.terminate() }
    }
}

/// Fixed-capacity byte accumulator. Reads from the pipe never stop, so the
/// child cannot block on a full kernel buffer, but retained bytes are capped
/// to bound memory in error paths.
private final class ByteSink: @unchecked Sendable {
    private let lock = NSLock()
    private var buffer = Data()
    private let cap: Int

    init(cap: Int) { self.cap = max(0, cap) }

    func append(_ data: Data) {
        guard cap > 0 else { return }
        lock.lock()
        defer { lock.unlock() }
        let room = cap - buffer.count
        guard room > 0 else { return }
        if data.count <= room {
            buffer.append(data)
        } else {
            buffer.append(data.prefix(room))
        }
    }

    func snapshot() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return buffer
    }
}

/// One-shot event bridge from `Process.terminationHandler` (called on a
/// Foundation queue) to any number of async `wait()` callers. `wait()`
/// also honors task cancellation so the surrounding `TaskGroup` can be torn
/// down without deadlocking on an un-cancellable continuation.
///
/// Return value distinguishes "the terminationHandler fired" (`true`) from
/// "our task was cancelled while waiting" (`false`); callers that need to
/// touch `Process.terminationStatus` must guard on the returned `true`.
private final class TerminationWaiter: @unchecked Sendable {
    private let lock = NSLock()
    private var signalled = false
    private var nextID: UInt64 = 0
    private var waiters: [UInt64: CheckedContinuation<Bool, Never>] = [:]

    func signal() {
        lock.lock()
        signalled = true
        let toResume = waiters
        waiters.removeAll()
        lock.unlock()
        for (_, continuation) in toResume { continuation.resume(returning: true) }
    }

    @discardableResult
    func wait() async -> Bool {
        let id: UInt64 = {
            lock.lock()
            defer { lock.unlock() }
            let id = nextID
            nextID &+= 1
            return id
        }()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                let resumeImmediatelyWith: Bool? = {
                    lock.lock()
                    defer { lock.unlock() }
                    if signalled { return true }
                    waiters[id] = continuation
                    return nil
                }()
                if let value = resumeImmediatelyWith { continuation.resume(returning: value) }
            }
        } onCancel: {
            lock.lock()
            let continuation = waiters.removeValue(forKey: id)
            lock.unlock()
            continuation?.resume(returning: false)
        }
    }
}
