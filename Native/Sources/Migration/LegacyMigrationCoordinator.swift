import AppKit
import Foundation

enum LegacyMigrationError: LocalizedError {
    case alreadyRunning
    case validationFailed(String)

    var errorDescription: String? {
        switch self {
        case .alreadyRunning: "Another Mouthpiece migration is already running."
        case .validationFailed(let reason): "Legacy data migration validation failed: \(reason)"
        }
    }
}

struct LegacyMigrationReport: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let completedAt: Date
    let sourceVersion: String?
    let sourcePath: String?
    let backupPath: String?
    let importedSettingCount: Int
    let importedCredentialAccounts: [String]
    let ignoredSettingKeys: [String]
    let copiedLegacyDatabase: Bool
}

@MainActor
final class LegacyMigrationCoordinator {
    private let fileManager: FileManager
    private let migrationLockURL: URL
    private let anotherInstanceIsRunning: () -> Bool
    private let environmentImporter = LegacyEnvironmentImporter()
    private let localStorageImporter = LegacyLocalStorageImporter()

    init(
        fileManager: FileManager = .default,
        migrationLockURL: URL = AppPaths.applicationSupportDirectory
            .appendingPathComponent("native-migration.lock"),
        anotherInstanceIsRunning: @escaping () -> Bool = {
            let currentPID = ProcessInfo.processInfo.processIdentifier
            return NSRunningApplication.runningApplications(withBundleIdentifier: "com.mouthpiece.app")
                .contains { $0.processIdentifier != currentPID }
        }
    ) {
        self.fileManager = fileManager
        self.migrationLockURL = migrationLockURL
        self.anotherInstanceIsRunning = anotherInstanceIsRunning
    }

    func run(settings: SettingsRepository, keychain: KeychainStore) async throws -> LegacyMigrationReport? {
        guard !migrationIsComplete() else { return nil }
        let lock = try acquireMigrationLock()
        defer { lock.unlock() }
        guard !migrationIsComplete() else { return nil }

        let source = legacySourceDirectory()
        let backup = try source.map(createBackup)
        var values: [String: String] = [:]
        var ignoredSettingKeys: [String] = []

        if let source {
            let environmentURL = source.appendingPathComponent(".env")
            if fileManager.fileExists(atPath: environmentURL.path) {
                values.merge(try environmentImporter.read(url: environmentURL)) { _, current in current }
            }
            let copiedLevelDB = backup?
                .appendingPathComponent("Local Storage/leveldb", isDirectory: true)
            let sourceLevelDB = source
                .appendingPathComponent("Local Storage/leveldb", isDirectory: true)
            let levelDB = copiedLevelDB.flatMap {
                fileManager.fileExists(atPath: $0.path) ? $0 : nil
            } ?? sourceLevelDB
            if fileManager.fileExists(atPath: levelDB.path) {
                let localValues = try localStorageImporter.read(levelDBDirectory: levelDB)
                values.merge(localValues) { current, _ in current }
            }
        }

        ignoredSettingKeys = values.keys.filter { !Self.allowedValueKeys.contains($0) }.sorted()
        values = Self.filterAllowedValues(values)
        let credentials = environmentImporter.credentials(from: values)
        let settingsBackup = settings.migrationBackup()
        var insertedCredentials: [CredentialAccount] = []
        var copiedDatabase = false
        do {
            copiedDatabase = try copyLegacyDatabaseIfNeeded(from: source)
            for (account, value) in credentials where try await keychain.read(account) == nil {
                try await keychain.write(value, for: account)
                insertedCredentials.append(account)
            }
            try settings.importLegacyValues(values)
        } catch {
            settings.restoreMigrationBackup(settingsBackup)
            for account in insertedCredentials { try? await keychain.delete(account) }
            if copiedDatabase { removeMigratedDatabase() }
            throw error
        }
        let migratedSettings = settings.load()

        let report = LegacyMigrationReport(
            schemaVersion: 1,
            completedAt: Date(),
            sourceVersion: values["APP_VERSION"] ?? values["appVersion"],
            sourcePath: source?.path,
            backupPath: backup?.path,
            importedSettingCount: values.count,
            importedCredentialAccounts: insertedCredentials.map(\.rawValue).sorted(),
            ignoredSettingKeys: ignoredSettingKeys,
            copiedLegacyDatabase: copiedDatabase
        )
        do {
            try writeMarker(report)
            try await validate(
                report,
                settings: settings,
                expectedSettings: migratedSettings,
                keychain: keychain,
                credentials: credentials.filter { insertedCredentials.contains($0.key) }
            )
            return report
        } catch {
            try? fileManager.removeItem(at: AppPaths.migrationMarkerURL)
            settings.restoreMigrationBackup(settingsBackup)
            for account in insertedCredentials { try? await keychain.delete(account) }
            if copiedDatabase { removeMigratedDatabase() }
            throw error
        }
    }

    private func legacySourceDirectory() -> URL? {
        let applicationSupport = fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support", isDirectory: true)
        let candidates = [
            AppPaths.applicationSupportDirectory,
            applicationSupport.appendingPathComponent("OpenWhispr", isDirectory: true),
            applicationSupport.appendingPathComponent("OpenWhispr-development", isDirectory: true),
            applicationSupport.appendingPathComponent("VoiceInk", isDirectory: true),
            applicationSupport.appendingPathComponent("VoiceInk-development", isDirectory: true),
        ]
        return candidates.first(where: containsLegacyState)
    }

    private func containsLegacyState(_ directory: URL) -> Bool {
        [
            ".env",
            "transcriptions.db",
            "transcriptions-dev.db",
            "Local Storage/leveldb/CURRENT",
        ].contains { fileManager.fileExists(atPath: directory.appendingPathComponent($0).path) }
    }

    private func createBackup(source: URL) throws -> URL {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        let timestamp = formatter.string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let directory = AppPaths.applicationSupportDirectory
            .appendingPathComponent("migration-backup-\(timestamp)", isDirectory: true)
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        for name in [
            ".env",
            "Local Storage",
            "transcriptions.db",
            "transcriptions.db-wal",
            "transcriptions.db-shm",
            "transcriptions-dev.db",
            "transcriptions-dev.db-wal",
            "transcriptions-dev.db-shm",
        ] {
            let sourceItem = source.appendingPathComponent(name)
            guard fileManager.fileExists(atPath: sourceItem.path) else { continue }
            try fileManager.copyItem(at: sourceItem, to: directory.appendingPathComponent(name))
        }
        return directory
    }

    private func copyLegacyDatabaseIfNeeded(from source: URL?) throws -> Bool {
        guard let source,
              source.standardizedFileURL != AppPaths.applicationSupportDirectory.standardizedFileURL,
              !fileManager.fileExists(atPath: AppPaths.databaseURL.path) else {
            return false
        }
        let baseName = fileManager.fileExists(atPath: source.appendingPathComponent("transcriptions.db").path)
            ? "transcriptions.db"
            : "transcriptions-dev.db"
        let sourceDatabase = source.appendingPathComponent(baseName)
        guard fileManager.fileExists(atPath: sourceDatabase.path) else { return false }
        do {
            try fileManager.copyItem(at: sourceDatabase, to: AppPaths.databaseURL)
            for suffix in ["-wal", "-shm"] {
                let companion = source.appendingPathComponent(baseName + suffix)
                if fileManager.fileExists(atPath: companion.path) {
                    try fileManager.copyItem(
                        at: companion,
                        to: URL(fileURLWithPath: AppPaths.databaseURL.path + suffix)
                    )
                }
            }
        } catch {
            removeMigratedDatabase()
            throw error
        }
        return true
    }

    private func removeMigratedDatabase() {
        for suffix in ["", "-wal", "-shm"] {
            try? fileManager.removeItem(at: URL(fileURLWithPath: AppPaths.databaseURL.path + suffix))
        }
    }

    private func writeMarker(_ report: LegacyMigrationReport) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(report).write(to: AppPaths.migrationMarkerURL, options: .atomic)
    }

    private func migrationIsComplete() -> Bool {
        guard let data = try? Data(contentsOf: AppPaths.migrationMarkerURL) else { return false }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let report = try? decoder.decode(LegacyMigrationReport.self, from: data) else {
            return false
        }
        guard report.schemaVersion == 1 else { return false }
        if report.copiedLegacyDatabase, !fileManager.fileExists(atPath: AppPaths.databaseURL.path) {
            return false
        }
        if let backupPath = report.backupPath, !fileManager.fileExists(atPath: backupPath) {
            return false
        }
        return true
    }

    func acquireMigrationLock() throws -> NSDistributedLock {
        guard let lock = NSDistributedLock(path: migrationLockURL.path) else {
            throw LegacyMigrationError.validationFailed("migration lock could not be created")
        }
        guard lock.try() else {
            guard !anotherInstanceIsRunning() else { throw LegacyMigrationError.alreadyRunning }
            lock.break()
            guard lock.try() else { throw LegacyMigrationError.alreadyRunning }
            return lock
        }
        return lock
    }

    private func validate(
        _ report: LegacyMigrationReport,
        settings: SettingsRepository,
        expectedSettings: AppSettings,
        keychain: KeychainStore,
        credentials: [CredentialAccount: String]
    ) async throws {
        guard settings.persistedSettingsForMigration() == expectedSettings else {
            throw LegacyMigrationError.validationFailed("settings could not be read back")
        }
        for (account, expected) in credentials {
            guard try await keychain.read(account) == expected else {
                throw LegacyMigrationError.validationFailed("credential \(account.rawValue) is missing")
            }
        }
        guard migrationIsComplete() else {
            throw LegacyMigrationError.validationFailed("completion marker is inconsistent")
        }
    }

    private static let allowedValueKeys: Set<String> = Set([
        "APP_VERSION", "appVersion", "uiLanguage", "UI_LANGUAGE", "theme",
        "dictationKey", "DICTATION_KEY", "translationDictationKey", "preferredLanguage",
        "selectedMicDeviceId", "selectedMicDeviceUID", "localTranscriptionProvider",
        "whisperModel", "parakeetModel", "qwenAsrModel", "fallbackWhisperModel",
        "cloudTranscriptionProvider", "cloudTranscriptionModel", "cloudTranscriptionBaseUrl",
        "OPENAI_API_BASE", "reasoningProvider", "reasoningModel", "cloudReasoningBaseUrl",
        "translationTargetLang", "soundPreset",
        "deepgramStreamingEnabled", "sonioxRealtimeEnabled", "assemblyAiStreaming",
        "useLocalWhisper", "allowOpenAIFallback", "allowCloudFallback", "allowLocalFallback",
        "useReasoningModel", "bailianReasoningEnableThinking", "customReasoningEnableThinking",
        "translationEnabled", "cloudBackupEnabled", "sensitiveAppProtectionEnabled",
        "sensitiveAppBlockInsertion", "allowSensitiveAppCloudReasoning",
        "allowSensitiveAppPasteMonitoring", "audioCuesEnabled", "debugMode",
        "onboardingCompleted", "customCleanupPrompt", "terminologyProfile", "customDictionary",
    ]).union(LegacyEnvironmentImporter.credentialKeys.keys)
        .union(LegacyEnvironmentImporter.localStorageCredentialKeys.keys)

    static func filterAllowedValues(_ values: [String: String]) -> [String: String] {
        values.filter { allowedValueKeys.contains($0.key) }
    }
}
