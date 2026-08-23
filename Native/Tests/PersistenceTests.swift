import Foundation
import Security
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

    // P2-11: prune() only deletes non-active files, so on HEAD the active
    // debug log grows without bound. Post-fix, DebugLogStore tracks bytes and
    // rolls the active file at ~4 MB (configurable). This test uses a small
    // 256 KB threshold to stay fast, writes ~500 KB of records, and asserts
    // that at least one archive was produced, the archive is still readable
    // JSON, and the active file starts fresh below the threshold.
    func testLogFileRollsOverAtSizeThreshold() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-LogRoll-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let threshold = 256 * 1024
        let store = DebugLogStore(
            enabled: true,
            directory: directory,
            maximumFileBytes: threshold
        )
        let payload = String(repeating: "A", count: 1000)
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        for index in 0 ..< 400 {
            await store.write(
                .info,
                "\(index):\(payload)",
                now: start.addingTimeInterval(Double(index) * 0.001)
            )
        }

        let files = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.fileSizeKey],
            options: [.skipsHiddenFiles]
        ).filter { $0.lastPathComponent.hasPrefix("debug-") && $0.pathExtension == "log" }
        XCTAssertGreaterThan(
            files.count, 1,
            "Roll should have produced at least one archive plus a fresh active file"
        )

        let archives = files.filter { $0.lastPathComponent.contains("-rolled") }
        let active = files.filter { !$0.lastPathComponent.contains("-rolled") }
        XCTAssertFalse(archives.isEmpty, "Expected at least one -rolled archive")
        XCTAssertEqual(active.count, 1, "Exactly one active (non-rolled) file expected")

        let archive = archives.sorted { $0.lastPathComponent < $1.lastPathComponent }[0]
        let archiveData = try Data(contentsOf: archive)
        let archiveString = String(data: archiveData, encoding: .utf8) ?? ""
        XCTAssertTrue(
            archiveString.contains(payload),
            "Archive must retain original log payloads"
        )
        let firstLine = archiveString.split(separator: "\n").first.map(String.init) ?? ""
        let decoded = try? JSONSerialization.jsonObject(with: Data(firstLine.utf8)) as? [String: Any]
        XCTAssertNotNil(decoded, "First archived line must be valid JSON")
        XCTAssertEqual(decoded?["level"] as? String, "info")

        if let activeURL = active.first {
            let size = (try FileManager.default.attributesOfItem(atPath: activeURL.path)[.size] as? Int) ?? 0
            XCTAssertLessThan(
                size, threshold,
                "Active file must start fresh under the threshold"
            )
        }
    }

    // NEW-5: keychain writes must pin accessibility to the device-only
    // variant on BOTH the SecItemAdd (first write) and SecItemUpdate
    // (subsequent overwrite) paths, so credentials cannot ride iCloud Keychain
    // sync nor be restored to another device from an encrypted backup. This
    // test reads back kSecAttrAccessible via SecItemCopyMatching after each
    // write to observe the persisted attribute — a stronger check than
    // asserting on the constant, which would miss a regression that dropped
    // the attribute from either dictionary. Uses a unique per-test service so
    // it never prompts SecurityAgent (same pattern the round-trip test uses).
    func testCredentialAccessibleAttributeIsDeviceOnlyOnAddAndUpdate() async throws {
        let service = "com.mouthpiece.app.tests.\(UUID().uuidString)"
        let store = KeychainStore(service: service)
        do {
            try await store.write("first", for: .openAI)
        } catch KeychainError.unhandled(let status) {
            throw XCTSkip("The keychain is unavailable in this environment (OSStatus \(status)).")
        }
        addTeardownBlock { try? await store.delete(.openAI) }

        // Add path: fresh insert must land as device-only.
        XCTAssertEqual(
            try readAccessibleAttribute(service: service, account: CredentialAccount.openAI.rawValue),
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
        )

        // Update path: overwriting an existing item must preserve device-only.
        try await store.write("second", for: .openAI)
        XCTAssertEqual(
            try readAccessibleAttribute(service: service, account: CredentialAccount.openAI.rawValue),
            kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String
        )
    }

    private func readAccessibleAttribute(service: String, account: String) throws -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnAttributes as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess,
              let attributes = item as? [String: Any],
              let value = attributes[kSecAttrAccessible as String] as? NSString
        else {
            throw KeychainError.unhandled(status)
        }
        return value as String
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

    // P1-7: clear() 后 .db 与 -wal 磁盘文件都不得残留任何听写明文。
    // 依赖 secure_delete=ON（就地清零被释放的页面）+ wal_checkpoint(TRUNCATE)
    // （截断 -wal）+ VACUUM（重写整库覆盖历史 freelist）三步同时生效。
    func testClearHistoryLeavesNoPlaintextInDatabaseOrWAL() async throws {
        let (repository, cleanup, url) = try makeHistoryRepositoryWithURL()
        defer { cleanup() }
        let needle = "MP-P17-NEEDLE-\(UUID().uuidString)"
        _ = try await repository.save(text: needle, rawText: needle)

        try await repository.clear()

        let needleBytes = Data(needle.utf8)
        let dbData = try Data(contentsOf: url)
        XCTAssertNil(
            dbData.range(of: needleBytes),
            "Cleared transcript must not survive in the main .db file"
        )

        let walURL = URL(fileURLWithPath: url.path + "-wal")
        if FileManager.default.fileExists(atPath: walURL.path) {
            let walData = try Data(contentsOf: walURL)
            XCTAssertNil(
                walData.range(of: needleBytes),
                "Cleared transcript must not survive in the -wal sidecar"
            )
        }
    }

    // P1-8: prune() 有实际删除时，必须调用一次 pruneLogger 且消息含删除计数；
    // 无删除的运行不得产生任何日志——避免每次写入都刷日志。
    func testPruneEmitsInfoLogWhenRowsRemoved() async throws {
        let recorder = PruneLogRecorder()
        let (repository, cleanup) = try makeHistoryRepository { message in
            recorder.append(message)
        }
        defer { cleanup() }
        let base = Date(timeIntervalSince1970: 1_700_000_000)
        let day: TimeInterval = 86_400
        for index in 1...3 {
            try await repository.restore(TranscriptionRecord(
                id: Int64(index),
                text: "expired \(index)",
                rawText: nil,
                timestamp: base.addingTimeInterval(TimeInterval(index))
            ))
        }
        try await repository.restore(TranscriptionRecord(
            id: 99, text: "kept", rawText: nil, timestamp: base.addingTimeInterval(91 * day)
        ))

        // 90 天窗口外的 3 条应被裁掉。
        let deleted = try await repository.prune(now: base.addingTimeInterval(91 * day))
        XCTAssertEqual(deleted, 3)

        let messages = recorder.snapshot()
        XCTAssertEqual(messages.count, 1, "prune() 有删除时应仅记录一次 info 日志")
        let message = try XCTUnwrap(messages.first)
        XCTAssertTrue(
            message.contains("\(deleted)"),
            "info 日志必须提及删除条数 \(deleted)，实际为：\(message)"
        )

        // 第二次调用，没有可删的行——不得再追加任何日志。
        let secondPass = try await repository.prune(now: base.addingTimeInterval(91 * day))
        XCTAssertEqual(secondPass, 0)
        XCTAssertEqual(recorder.snapshot().count, 1, "零删除的 prune() 不得触发日志")
    }

    // P2-17: prune() 每次 save() 都跑一次 self-anti-join 太贵；根治后 save() 只在
    // 攒够 pruneEveryNWrites 次写入才触发 prune()；启动时由调用方（生产为
    // AppEnvironment.initialize）显式跑一次以拿到删除条数用于日志。init 本身不
    // 再 prune（HistoryRepository 为 actor，init 无法同步 await 隔离方法）。
    // 用 pruneObserver 计数调用频次（与是否有删除无关）：
    //   1) 打开新库后显式 prune() 一次 → observer 计数 == 1（模拟启动清理）
    //   2) 连续 save() N-1 次 → observer 计数仍为 1（阈值下不触发）
    //   3) 再 save() 一次（第 N 次） → observer 计数变为 2（阈值命中触发一次）
    func testInsertsBelowThresholdDoNotTriggerPrune() async throws {
        let counter = PruneInvocationCounter()
        let (repository, cleanup) = try makeHistoryRepository(pruneObserver: {
            counter.increment()
        })
        defer { cleanup() }

        // 模拟 AppEnvironment.initialize() 的启动 prune 调用。
        _ = try await repository.prune()
        XCTAssertEqual(counter.value(), 1, "启动 prune() 应触发一次")

        let threshold = HistoryRepository.pruneEveryNWrites
        for index in 1...(threshold - 1) {
            _ = try await repository.save(text: "row \(index)", rawText: nil)
        }
        XCTAssertEqual(
            counter.value(), 1,
            "少于阈值的 save() 不得触发 prune()（当前 \(counter.value()) 次，期望 1 次）"
        )

        // 第 N 次 save() 应命中阈值，多触发一次 prune()。
        _ = try await repository.save(text: "row \(threshold)", rawText: nil)
        XCTAssertEqual(
            counter.value(), 2,
            "第 \(threshold) 次 save() 应触发一次 prune()（当前 \(counter.value()) 次，期望 2 次）"
        )
    }

    private func makeHistoryRepository() throws -> (HistoryRepository, () -> Void) {
        let (repository, cleanup, _) = try makeHistoryRepositoryWithURL()
        return (repository, cleanup)
    }

    private func makeHistoryRepository(
        pruneLogger: @escaping @Sendable (String) -> Void
    ) throws -> (HistoryRepository, () -> Void) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-HistoryTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("history.sqlite3")
        let repository = try HistoryRepository(databaseURL: url, pruneLogger: pruneLogger)
        return (repository, { try? FileManager.default.removeItem(at: directory) })
    }

    private func makeHistoryRepository(
        pruneObserver: @escaping @Sendable () -> Void
    ) throws -> (HistoryRepository, () -> Void) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-HistoryTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("history.sqlite3")
        let repository = try HistoryRepository(databaseURL: url, pruneObserver: pruneObserver)
        return (repository, { try? FileManager.default.removeItem(at: directory) })
    }

    private func makeHistoryRepositoryWithURL() throws -> (HistoryRepository, () -> Void, URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-HistoryTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("history.sqlite3")
        let repository = try HistoryRepository(databaseURL: url)
        return (repository, { try? FileManager.default.removeItem(at: directory) }, url)
    }
}

// P1-8: 线程安全的字符串桶——pruneLogger 是 @Sendable，允许跨 actor 调用。
private final class PruneLogRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var messages: [String] = []

    func append(_ message: String) {
        lock.lock()
        defer { lock.unlock() }
        messages.append(message)
    }

    func snapshot() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        return messages
    }
}

// P2-17: 线程安全的调用计数器——pruneObserver 是 @Sendable，允许跨 actor 调用。
private final class PruneInvocationCounter: @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func increment() {
        lock.lock()
        defer { lock.unlock() }
        count += 1
    }

    func value() -> Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}
