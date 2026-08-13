import Foundation
import os

enum SettingsRepositoryError: LocalizedError {
    case corruptedStore

    var errorDescription: String? {
        "Saved settings could not be read, so defaults were loaded. "
            + "Please review your preferences; the unreadable data was kept in place."
    }
}

@MainActor
final class SettingsRepository {
    private static let storageKey = "native.settings.v1"
    private let defaults: UserDefaults
    private var cached: AppSettings
    private(set) var loadFailed = false

    init(defaults: UserDefaults? = nil) {
        let defaults = defaults ?? Self.defaultStore()
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.storageKey) {
            if var decoded = Self.decodeWithDefaults(data) {
                decoded.normalize()
                cached = decoded
            } else {
                // Never silently discard the user's configuration: fall back
                // to defaults for this run but keep the unreadable blob so it
                // can be inspected or recovered, and let the UI warn the user.
                Logger(subsystem: "com.mouthpiece.app", category: "settings")
                    .error("Stored settings failed to decode (\(data.count) bytes); using defaults")
                loadFailed = true
                cached = AppSettings()
            }
        } else {
            cached = AppSettings()
        }
    }

    private static func defaultStore() -> UserDefaults {
        guard ProcessInfo.processInfo.environment["MOUTHPIECE_DATA_ROOT"] != nil else {
            return .standard
        }
        let suite = "com.mouthpiece.app.automation.\(ProcessInfo.processInfo.processIdentifier)"
        return UserDefaults(suiteName: suite) ?? .standard
    }

    func load() -> AppSettings {
        cached
    }

    func save(_ settings: AppSettings) throws {
        var normalized = settings
        normalized.normalize()
        let data = try JSONEncoder().encode(normalized)
        defaults.set(data, forKey: Self.storageKey)
        cached = normalized
    }

    func update(_ mutation: (inout AppSettings) -> Void) throws -> AppSettings {
        var next = cached
        mutation(&next)
        try save(next)
        return cached
    }

    private static func decodeWithDefaults(_ data: Data) -> AppSettings? {
        guard var defaults = try? JSONSerialization.jsonObject(
            with: JSONEncoder().encode(AppSettings())
        ) as? [String: Any],
        let stored = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let combined = merge(defaults: defaults, stored: stored)
        guard let merged = try? JSONSerialization.data(withJSONObject: combined) else { return nil }
        return try? JSONDecoder().decode(AppSettings.self, from: merged)
    }

    private static func merge(
        defaults: [String: Any],
        stored: [String: Any]
    ) -> [String: Any] {
        var combined = defaults
        for (key, value) in stored {
            if let defaultObject = defaults[key] as? [String: Any],
               let storedObject = value as? [String: Any] {
                combined[key] = merge(defaults: defaultObject, stored: storedObject)
            } else {
                combined[key] = value
            }
        }
        return combined
    }

}
