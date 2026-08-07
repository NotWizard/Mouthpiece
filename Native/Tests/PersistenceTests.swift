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
            GEMINI_API_KEY="sk-gemini" # trailing comment after quotes
            GROQ_API_KEY="sk-with#hash" # hash inside quotes stays
            INVALID KEY=value
            """)
        XCTAssertEqual(values["OPENAI_API_KEY"], "sk-test=value")
        XCTAssertEqual(values["BAILIAN_API_KEY"], "sk-bailian")
        XCTAssertEqual(values["GEMINI_API_KEY"], "sk-gemini")
        XCTAssertEqual(values["GROQ_API_KEY"], "sk-with#hash")
        XCTAssertNil(values["INVALID KEY"])
    }

    @MainActor
    func testCorruptSettingsSurfaceLoadFailureAndKeepTheBlob() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let garbage = Data("not json".utf8)
        defaults.set(garbage, forKey: "native.settings.v1")

        let repository = SettingsRepository(defaults: defaults)
        XCTAssertTrue(repository.loadFailed)
        XCTAssertEqual(repository.load().dictationKey, AppSettings().dictationKey)
        XCTAssertEqual(defaults.data(forKey: "native.settings.v1"), garbage)
    }

    @MainActor
    func testSettingsRoundTripAndNormalization() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        var settings = AppSettings()
        settings.dictationKey = "Hyper+K"
        settings.translationHotkeySuffix = "not-a-key"
        settings.cloudTranscriptionBaseURL = "not a url"
        settings.cloudTranscriptionProvider = "bailian"
        settings.cloudTranscriptionModel = BailianASRModel.funASR.rawValue
        settings.pauseOtherMediaDuringDictation = true
        settings.automaticallyPasteTranscription = false
        settings.keepTranscriptionInClipboard = true
        settings.reasoningProvider = "local"
        settings.reasoningModel = "qwen3-1.7b-q8_0"
        settings.reasoningBaseURL = ""
        try repository.save(settings)
        let loaded = repository.load()
        XCTAssertEqual(loaded.dictationKey, "RightCommand")
        XCTAssertEqual(loaded.translationHotkeySuffix, TranslationHotkey.defaultSuffix)
        XCTAssertEqual(loaded.cloudTranscriptionBaseURL, "https://api.openai.com/v1")
        XCTAssertEqual(loaded.cloudTranscriptionModel, BailianASRModel.funASR.rawValue)
        XCTAssertEqual(loaded.bailianTranscriptionModel, BailianASRModel.funASR.rawValue)
        XCTAssertTrue(loaded.pauseOtherMediaDuringDictation)
        XCTAssertFalse(loaded.automaticallyPasteTranscription)
        XCTAssertTrue(loaded.keepTranscriptionInClipboard)
        XCTAssertEqual(loaded.reasoningProvider, "openai")
        XCTAssertEqual(loaded.reasoningModel, "gpt-4o-mini")
        XCTAssertEqual(loaded.reasoningBaseURL, "https://api.openai.com/v1")
    }

    @MainActor
    func testNormalizationDisablesTranslationWhenCleanupIsOff() throws {
        // Translation output is produced by the cleanup pipeline; a legacy
        // blob may still carry the stale "translation on, cleanup off" combo.
        var settings = AppSettings()
        settings.translationEnabled = true
        settings.useReasoningModel = false
        settings.normalize()
        XCTAssertFalse(settings.translationEnabled)

        settings.useReasoningModel = true
        settings.translationEnabled = true
        settings.normalize()
        XCTAssertTrue(settings.translationEnabled)

        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        var stored = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(AppSettings())) as? [String: Any]
        )
        stored["translationEnabled"] = true
        stored["useReasoningModel"] = false
        defaults.set(
            try JSONSerialization.data(withJSONObject: stored),
            forKey: "native.settings.v1"
        )

        let loaded = SettingsRepository(defaults: defaults).load()
        XCTAssertFalse(loaded.useReasoningModel)
        XCTAssertFalse(loaded.translationEnabled)
    }

    @MainActor
    func testTerminologyNormalizationHandlesDuplicateTrimmedKeys() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        var settings = AppSettings()
        settings.terminologyProfile.replacementRules = [
            " Mouthpiece ": "fallback",
            "Mouthpiece": "preferred",
        ]

        try repository.save(settings)

        XCTAssertEqual(
            repository.load().terminologyProfile.replacementRules,
            ["Mouthpiece": "preferred"]
        )
    }

    @MainActor
    func testLegacyTerminologyMigrationHandlesDuplicateMappings() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        let profile = """
            {"homophoneMappings":[
              {"source":"嘴替","target":"Mouthpiece Legacy"},
              {"source":"嘴替","target":"Mouthpiece"}
            ]}
            """

        try repository.importLegacyValues(["terminologyProfile": profile])

        XCTAssertEqual(
            repository.load().terminologyProfile.replacementRules,
            ["嘴替": "Mouthpiece"]
        )
    }

    @MainActor
    func testOlderSettingsKeepExistingTranscriptionDeliveryDefaults() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        var stored = try XCTUnwrap(
            JSONSerialization.jsonObject(with: JSONEncoder().encode(AppSettings())) as? [String: Any]
        )
        stored.removeValue(forKey: "automaticallyPasteTranscription")
        stored.removeValue(forKey: "keepTranscriptionInClipboard")
        defaults.set(
            try JSONSerialization.data(withJSONObject: stored),
            forKey: "native.settings.v1"
        )

        let loaded = SettingsRepository(defaults: defaults).load()
        XCTAssertTrue(loaded.automaticallyPasteTranscription)
        XCTAssertFalse(loaded.keepTranscriptionInClipboard)
    }

    @MainActor
    func testOlderNestedSettingsGainMissingDefaultsWithoutDataLoss() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let stored: [String: Any] = [
            "uiLanguage": UILanguage.english.rawValue,
            "terminologyProfile": ["preferredTerms": ["Qwen"]],
        ]
        defaults.set(
            try JSONSerialization.data(withJSONObject: stored),
            forKey: "native.settings.v1"
        )

        let loaded = SettingsRepository(defaults: defaults).load()

        XCTAssertEqual(loaded.uiLanguage, .english)
        XCTAssertEqual(loaded.terminologyProfile.preferredTerms, ["Qwen"])
        XCTAssertTrue(loaded.terminologyProfile.avoidedTerms.isEmpty)
        XCTAssertTrue(loaded.terminologyProfile.replacementRules.isEmpty)
    }

    @MainActor
    func testMigrationBackupRestoreNormalizesRuntimeSettings() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        var backup = AppSettings()
        backup.dictationKey = ""
        backup.reasoningProvider = "local"
        backup.cloudTranscriptionBaseURL = "http://api.example.com/v1"

        repository.restoreMigrationBackup(try JSONEncoder().encode(backup))

        let restored = repository.load()
        XCTAssertEqual(restored.dictationKey, "RightCommand")
        XCTAssertEqual(restored.reasoningProvider, "openai")
        XCTAssertEqual(restored.cloudTranscriptionBaseURL, "https://api.openai.com/v1")
    }

    @MainActor
    func testSettingsRejectRemotePlaintextProviderURLs() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        var settings = AppSettings()
        settings.cloudTranscriptionBaseURL = "http://api.example.com/v1"
        settings.reasoningBaseURL = "http://api.example.com/v1"

        try repository.save(settings)

        let loaded = repository.load()
        XCTAssertEqual(loaded.cloudTranscriptionBaseURL, "https://api.openai.com/v1")
        XCTAssertEqual(loaded.reasoningBaseURL, "https://api.openai.com/v1")
    }

    @MainActor
    func testSettingsAllowPlaintextLoopbackProviderURLs() throws {
        let suite = "MouthpieceTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let repository = SettingsRepository(defaults: defaults)
        var settings = AppSettings()
        settings.cloudTranscriptionBaseURL = "http://127.0.0.1:8080/v1/"
        settings.reasoningBaseURL = "http://localhost:11434/v1/"

        try repository.save(settings)

        let loaded = repository.load()
        XCTAssertEqual(loaded.cloudTranscriptionBaseURL, "http://127.0.0.1:8080/v1")
        XCTAssertEqual(loaded.reasoningBaseURL, "http://localhost:11434/v1")
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

    func testRedactorMasksVendorKeysAndURLQueryCredentials() {
        let gemini = LogRedactor.redact("request AIzaSyD9tSrke72PouQMnMXa7eZSW0jkFMBWY failed")
        XCTAssertFalse(gemini.contains("AIzaSyD9tSrke72PouQMnMXa7eZSW0jkFMBWY"))
        XCTAssertTrue(gemini.contains("[REDACTED_API_KEY]"))

        let groq = LogRedactor.redact("groq gsk_abcDEF0123456789abcDEF0123 rejected")
        XCTAssertFalse(groq.contains("gsk_abcDEF0123456789abcDEF0123"))
        XCTAssertTrue(groq.contains("[REDACTED_API_KEY]"))

        // Query credentials lose only the value: the parameter name stays and
        // sibling parameters survive up to the next &.
        let url = LogRedactor.redact("GET https://example.com/v1?key=secret123&model=gpt")
        XCTAssertFalse(url.contains("secret123"))
        XCTAssertTrue(url.contains("?key=[REDACTED]"))
        XCTAssertTrue(url.contains("&model=gpt"))

        let apiKey = LogRedactor.redact("wss://example.com/listen?api_key=abc123")
        XCTAssertFalse(apiKey.contains("abc123"))
        XCTAssertTrue(apiKey.contains("?api_key="))

        let token = LogRedactor.redact("https://example.com/cb?token=xyz789")
        XCTAssertFalse(token.contains("xyz789"))
        XCTAssertTrue(token.contains("?token="))

        // Plain prose and short vendor-like prefixes must not be touched.
        let prose = "Ask AIzaBot about gsk_short via ?monkey=banana"
        XCTAssertEqual(LogRedactor.redact(prose), prose)
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
