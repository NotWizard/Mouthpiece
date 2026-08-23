import XCTest
@testable import Mouthpiece

final class LocalModelRuntimeTests: XCTestCase {
    func testStaleServerRecordFromDeadOwnerIsReaped() throws {
        let scanRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-Reap-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: scanRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scanRoot) }
        let deadOwner = Process()
        deadOwner.executableURL = URL(fileURLWithPath: "/bin/sh")
        deadOwner.arguments = ["-c", "exit 0"]
        try deadOwner.run()
        deadOwner.waitUntilExit()
        let child = Process()
        child.executableURL = URL(fileURLWithPath: "/bin/sleep")
        child.arguments = ["60"]
        try child.run()
        defer { if child.isRunning { child.terminate(); child.waitUntilExit() } }
        let recordURL = scanRoot.appendingPathComponent("whisper-\(child.processIdentifier).json")
        try JSONSerialization.data(withJSONObject: [
            "ownerPID": Int(deadOwner.processIdentifier),
            "port": 8178, "executable": "/bin/sleep", "model": "test-model",
            "launchedAt": Date().timeIntervalSince1970,
        ]).write(to: recordURL, options: .atomic)
        LocalModelRuntime.reapOrphanServers(directory: scanRoot)
        XCTAssertFalse(FileManager.default.fileExists(atPath: recordURL.path))
        let deadline = Date().addingTimeInterval(3)
        while child.isRunning, Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
        XCTAssertFalse(child.isRunning)
    }
}
