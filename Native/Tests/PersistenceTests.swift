import Foundation
import XCTest
@testable import Mouthpiece

final class PersistenceTests: XCTestCase {
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

    // E4(2): the round trip runs against a unique per-test service name, so it
    // never touches the real "com.mouthpiece.app.credentials" service.
    func testKeychainStoreRoundTripOverwriteAndDelete() async throws {
        let store = KeychainStore(service: "com.mouthpiece.app.tests.\(UUID().uuidString)")
        do {
            try await store.write("secret-one", for: .openAI)
        } catch KeychainError.unhandled(let status) {
            throw XCTSkip("The keychain is unavailable in this environment (OSStatus \(status)).")
        }
        addTeardownBlock { try? await store.delete(.openAI) }

        let stored = try await store.read(.openAI)
        XCTAssertEqual(stored, "secret-one")

        // A second write must take the SecItemUpdate path and replace the value.
        try await store.write("secret-two", for: .openAI)
        let updated = try await store.read(.openAI)
        XCTAssertEqual(updated, "secret-two")

        // Accounts that were never written read as nil and delete without throwing.
        let missing = try await store.read(.groq)
        XCTAssertNil(missing)
        try await store.delete(.groq)

        try await store.delete(.openAI)
        let removed = try await store.read(.openAI)
        XCTAssertNil(removed)
        // Deleting an already-deleted item stays a silent no-op.
        try await store.delete(.openAI)
    }

    // D7/γδ: the LIKE escape must turn %, _ and \ into literal matches; the
    // backslash doubles first so escaped wildcards are not re-escaped.
    func testEscapeLikePatternEscapesWildcardsAndBackslash() {
        XCTAssertEqual(HistoryRepository.escapeLikePattern("a%b_c\\d"), "a\\%b\\_c\\\\d")
        XCTAssertEqual(HistoryRepository.escapeLikePattern("plain"), "plain")
        XCTAssertEqual(HistoryRepository.escapeLikePattern("100%"), "100\\%")
    }

    // D7: %/_/\ in the query must match literally instead of acting as SQL
    // wildcards, and ASCII matching stays case-insensitive.
    func testHistorySearchMatchesWildcardsLiterallyAndCaseInsensitively() async throws {
        let (repository, cleanup) = try makeHistoryRepository()
        defer { cleanup() }
        _ = try await repository.save(text: "Progress 100% done", rawText: nil)
        _ = try await repository.save(text: "100 percent plain", rawText: nil)
        _ = try await repository.save(text: "alpha_beta underscore", rawText: nil)
        _ = try await repository.save(text: "alphaXbeta letter", rawText: nil)
        _ = try await repository.save(text: "back\\slash row", rawText: nil)

        let percent = try await repository.search(query: "100%")
        XCTAssertEqual(percent.map(\.text), ["Progress 100% done"], "% must not act as a wildcard")

        let underscore = try await repository.search(query: "alpha_beta")
        XCTAssertEqual(underscore.map(\.text), ["alpha_beta underscore"], "_ must not act as a wildcard")

        let backslash = try await repository.search(query: "back\\slash")
        XCTAssertEqual(backslash.map(\.text), ["back\\slash row"], "\\ must match itself literally")

        let caseInsensitive = try await repository.search(query: "pRoGrEsS")
        XCTAssertEqual(caseInsensitive.map(\.text), ["Progress 100% done"])

        // A raw-text-only hit must surface the record too.
        _ = try await repository.save(text: "polished output", rawText: "raw_only% source")
        let rawHit = try await repository.search(query: "raw_only%")
        XCTAssertEqual(rawHit.map(\.text), ["polished output"])

        // Blank queries fall back to recent() instead of matching nothing.
        let blank = try await repository.search(query: "   ")
        XCTAssertEqual(blank.count, 6)
    }

    // D7: offset paging over recent() and search() must be stable and free of
    // duplicates/gaps, keyed on the timestamp DESC, id DESC ordering.
    func testHistoryRecentAndSearchPaginateStablyWithOffset() async throws {
        let (repository, cleanup) = try makeHistoryRepository()
        defer { cleanup() }
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        for index in 1...5 {
            try await repository.restore(TranscriptionRecord(
                id: Int64(index),
                text: "item \(index)",
                rawText: nil,
                timestamp: base.addingTimeInterval(TimeInterval(index) * 60)
            ))
        }

        let pageOne = try await repository.recent(limit: 2, offset: 0)
        let pageTwo = try await repository.recent(limit: 2, offset: 2)
        let pageThree = try await repository.recent(limit: 2, offset: 4)
        XCTAssertEqual(pageOne.map(\.id), [5, 4])
        XCTAssertEqual(pageTwo.map(\.id), [3, 2])
        XCTAssertEqual(pageThree.map(\.id), [1])

        let searchPage = try await repository.search(query: "item", limit: 2, offset: 2)
        XCTAssertEqual(searchPage.map(\.id), [3, 2])
    }

    // F1: rows older than the retention window are pruned; newer rows stay.
    func testPruneRemovesRowsOlderThanRetentionWindow() async throws {
        let (repository, cleanup) = try makeHistoryRepository()
        defer { cleanup() }
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let day: TimeInterval = 86_400
        try await repository.restore(TranscriptionRecord(id: 1, text: "expired", rawText: nil, timestamp: base))
        try await repository.restore(TranscriptionRecord(
            id: 2, text: "inside window", rawText: nil, timestamp: base.addingTimeInterval(10 * day)
        ))
        try await repository.restore(TranscriptionRecord(
            id: 3, text: "fresh", rawText: nil, timestamp: base.addingTimeInterval(91 * day)
        ))

        // now = base + 91d => cutoff = base + 1d: only the row at `base` expires.
        let deleted = try await repository.prune(now: base.addingTimeInterval(91 * day))

        XCTAssertEqual(deleted, 1)
        let remaining = try await repository.recent(limit: 10)
        XCTAssertEqual(remaining.map(\.id), [3, 2])
    }

    // F1: the row cap keeps the newest retentionMaxRows records, deleting the
    // oldest; crossing the vacuum threshold must run VACUUM without breaking
    // the connection.
    func testPruneEnforcesRowCapDeletingOldestAndSurvivesVacuum() async throws {
        let (repository, cleanup) = try makeHistoryRepository()
        defer { cleanup() }
        let rowCount = HistoryRepository.retentionMaxRows + 201
        let now = Date()
        // Timestamps stay inside the retention window so only the row cap fires.
        let base = now.addingTimeInterval(-TimeInterval(rowCount) - 60)
        for index in 1...rowCount {
            try await repository.restore(TranscriptionRecord(
                id: Int64(index),
                text: "row \(index)",
                rawText: nil,
                timestamp: base.addingTimeInterval(TimeInterval(index))
            ))
        }

        // 201 deletions >= the 200-row vacuum threshold, so VACUUM runs too.
        let deleted = try await repository.prune(now: now)
        XCTAssertEqual(deleted, 201, "The 201 oldest rows above the cap must be deleted")

        var total = 0
        var offset = 0
        var oldestID = Int64.max
        while true {
            let page = try await repository.recent(limit: 1_000, offset: offset)
            if page.isEmpty { break }
            total += page.count
            oldestID = min(oldestID, page.map(\.id).min() ?? Int64.max)
            offset += 1_000
        }
        XCTAssertEqual(total, HistoryRepository.retentionMaxRows)
        XCTAssertEqual(oldestID, 202, "Deletion must start from the oldest rows")

        // The connection must stay usable after VACUUM.
        let afterVacuum = try await repository.save(text: "after vacuum", rawText: nil)
        XCTAssertEqual(afterVacuum.text, "after vacuum")
    }

    private func makeHistoryRepository() throws -> (HistoryRepository, () -> Void) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-HistoryTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let repository = try HistoryRepository(
            databaseURL: directory.appendingPathComponent("history.sqlite3")
        )
        return (repository, { try? FileManager.default.removeItem(at: directory) })
    }
}
