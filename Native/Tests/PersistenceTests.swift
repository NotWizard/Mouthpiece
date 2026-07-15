import Foundation
import swift_leveldb
import XCTest
@testable import Mouthpiece

final class PersistenceTests: XCTestCase {
    @MainActor
    func testMigrationLockRecoversOnlyWithoutAnotherRunningInstance() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-LockTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let staleURL = directory.appendingPathComponent("stale.lock")
        let staleHolder = try XCTUnwrap(NSDistributedLock(path: staleURL.path))
        XCTAssertTrue(staleHolder.try())
        let recovered = try LegacyMigrationCoordinator(
            migrationLockURL: staleURL,
            anotherInstanceIsRunning: { false }
        ).acquireMigrationLock()
        recovered.unlock()

        let activeURL = directory.appendingPathComponent("active.lock")
        let activeHolder = try XCTUnwrap(NSDistributedLock(path: activeURL.path))
        XCTAssertTrue(activeHolder.try())
        defer { activeHolder.unlock() }
        let coordinator = LegacyMigrationCoordinator(
            migrationLockURL: activeURL,
            anotherInstanceIsRunning: { true }
        )
        XCTAssertThrowsError(try coordinator.acquireMigrationLock()) { error in
            guard case LegacyMigrationError.alreadyRunning = error else {
                return XCTFail("Expected an already-running migration error")
            }
        }
    }

    func testEnvironmentParserHandlesQuotesCommentsAndEquals() {
        let values = LegacyEnvironmentImporter().parse("""
            # comment
            export OPENAI_API_KEY="sk-test=value"
            BAILIAN_API_KEY=sk-bailian # inline comment
            INVALID KEY=value
            """)
        XCTAssertEqual(values["OPENAI_API_KEY"], "sk-test=value")
        XCTAssertEqual(values["BAILIAN_API_KEY"], "sk-bailian")
        XCTAssertNil(values["INVALID KEY"])
    }

    @MainActor
    func testSettingsRoundTripAndNormalization() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        var settings = AppSettings()
        settings.dictationKey = ""
        settings.cloudTranscriptionBaseURL = "not a url"
        settings.pauseOtherMediaDuringDictation = true
        try repository.save(settings)
        let loaded = repository.load()
        XCTAssertEqual(loaded.dictationKey, "RightCommand")
        XCTAssertEqual(loaded.cloudTranscriptionBaseURL, "https://api.openai.com/v1")
        XCTAssertTrue(loaded.pauseOtherMediaDuringDictation)
    }

    func testHistoryRepositoryMigratesLegacySchemaAndPreservesRawText() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("MouthpieceTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("transcriptions.db")

        let repository = try HistoryRepository(databaseURL: url)
        let saved = try await repository.save(text: "clean", rawText: "raw")
        XCTAssertEqual(saved.text, "clean")
        XCTAssertEqual(saved.rawText, "raw")
        let recent = try await repository.recent()
        XCTAssertEqual(recent, [saved])

        try await repository.delete(id: saved.id)
        let afterDeletion = try await repository.recent()
        XCTAssertTrue(afterDeletion.isEmpty)
        try await repository.restore(saved)
        let afterRestore = try await repository.recent()
        XCTAssertEqual(afterRestore, [saved])

        try await repository.replaceDictionary(["Qwen", "", "Mouthpiece"])
        let dictionary = try await repository.dictionary()
        XCTAssertEqual(dictionary, ["Qwen", "Mouthpiece"])
    }

    func testRedactorRemovesCredentialsAndUserPath() {
        let input = "Authorization: Bearer abc.def API_KEY=sk-123456789 /Users/alice/file.wav"
        let output = LogRedactor.redact(input)
        XCTAssertFalse(output.contains("abc.def"))
        XCTAssertFalse(output.contains("sk-123456789"))
        XCTAssertFalse(output.contains("alice"))
    }

    func testDebugLogsOlderThanSevenDaysAreRemoved() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-LogTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let now = Date(timeIntervalSince1970: 2_000_000_000)
        let expired = directory.appendingPathComponent("debug-expired.log")
        let current = directory.appendingPathComponent("debug-current.log")
        FileManager.default.createFile(atPath: expired.path, contents: Data())
        FileManager.default.createFile(atPath: current.path, contents: Data())
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-(8 * 24 * 60 * 60))],
            ofItemAtPath: expired.path
        )
        try FileManager.default.setAttributes(
            [.modificationDate: now.addingTimeInterval(-(6 * 24 * 60 * 60))],
            ofItemAtPath: current.path
        )

        let store = DebugLogStore(enabled: true, directory: directory)
        try await store.prune(now: now)

        XCTAssertFalse(FileManager.default.fileExists(atPath: expired.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: current.path))
    }

    func testLegacyLocalStorageImporterReadsChromiumLevelDBEncoding() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-LevelDBTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        do {
            let database = try Database(path: directory.path)
            try database.put(chromiumValue("zh-CN"), forKey: chromiumKey("uiLanguage"), sync: true)
            try database.put(chromiumValue("RightCommand"), forKey: chromiumKey("dictationKey"), sync: true)
            try database.put(chromiumValue("sk-test"), forKey: chromiumKey("bailianApiKey"), sync: true)
        }

        let values = try LegacyLocalStorageImporter().read(levelDBDirectory: directory)

        XCTAssertEqual(values["uiLanguage"], "zh-CN")
        XCTAssertEqual(values["dictationKey"], "RightCommand")
        XCTAssertEqual(values["bailianApiKey"], "sk-test")
    }

    func testLegacyLocalStorageImporterRejectsForeignOrigin() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-LevelDBTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        do {
            let database = try Database(path: directory.path)
            try database.put(
                chromiumValue("stolen"),
                forKey: chromiumKey("uiLanguage", origin: "_https://example.com"),
                sync: true
            )
        }

        XCTAssertTrue(try LegacyLocalStorageImporter().read(levelDBDirectory: directory).isEmpty)
    }

    @MainActor
    func testMigrationAllowlistDropsUnknownSettings() {
        let filtered = LegacyMigrationCoordinator.filterAllowedValues([
            "uiLanguage": "zh-CN",
            "unknownSetting": "must-not-import",
        ])

        XCTAssertEqual(filtered, ["uiLanguage": "zh-CN"])
    }

    private func chromiumKey(_ key: String, origin: String = "_file://") -> Data {
        var data = Data(origin.utf8)
        data.append(0)
        data.append(1)
        data.append(contentsOf: key.utf8)
        return data
    }

    private func chromiumValue(_ value: String) -> Data {
        var data = Data([1])
        data.append(contentsOf: value.utf8)
        return data
    }
}
