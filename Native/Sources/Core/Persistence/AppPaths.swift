import Foundation

enum AppPaths {
    private static let isolatedDataRoot: URL? = {
        guard let path = ProcessInfo.processInfo.environment["MOUTHPIECE_DATA_ROOT"],
              !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }()

    static let cacheDirectory: URL = {
        if let isolatedDataRoot {
            return isolatedDataRoot.appendingPathComponent("cache", isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cache/mouthpiece", isDirectory: true)
    }()

    static let legacyCacheDirectory: URL = {
        if let isolatedDataRoot {
            return isolatedDataRoot.appendingPathComponent("legacy-cache", isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".cache/openwhispr", isDirectory: true)
    }()

    static let applicationSupportDirectory: URL = {
        if let isolatedDataRoot {
            return isolatedDataRoot.appendingPathComponent("Application Support", isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Mouthpiece", isDirectory: true)
    }()

    static let databaseURL = applicationSupportDirectory.appendingPathComponent("transcriptions.db")
    static let logsDirectory = applicationSupportDirectory.appendingPathComponent("logs", isDirectory: true)
    static let migrationMarkerURL = applicationSupportDirectory.appendingPathComponent("native-migration-v1.json")
    static let legacyEnvironmentURL = applicationSupportDirectory.appendingPathComponent(".env")
    static let whisperModelsDirectory = cacheDirectory.appendingPathComponent("whisper-models", isDirectory: true)
    static let parakeetModelsDirectory = cacheDirectory.appendingPathComponent("parakeet-models", isDirectory: true)
    static let qwenASRModelsDirectory = cacheDirectory.appendingPathComponent("qwen-asr-models", isDirectory: true)
    static let qwenASRRuntimeDirectory = cacheDirectory.appendingPathComponent("qwen-asr-runtime", isDirectory: true)
    static let legacyWhisperModelsDirectory = legacyCacheDirectory.appendingPathComponent("whisper-models", isDirectory: true)
    static let legacyParakeetModelsDirectory = legacyCacheDirectory.appendingPathComponent("parakeet-models", isDirectory: true)
    static let legacyQwenASRModelsDirectory = legacyCacheDirectory.appendingPathComponent("qwen-asr-models", isDirectory: true)
    static let legacyQwenASRRuntimeDirectory = legacyCacheDirectory.appendingPathComponent("qwen-asr-runtime", isDirectory: true)

    static func prepareApplicationSupport() throws {
        try FileManager.default.createDirectory(
            at: applicationSupportDirectory,
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
    }
}
