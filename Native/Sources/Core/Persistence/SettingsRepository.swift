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
    // P3-5: a slider drag on the control panel fires ~60 save() calls per
    // second; on HEAD each one re-encoded and re-wrote the full settings
    // blob to UserDefaults from the main actor. Deferring the write behind
    // this debounce collapses a rapid burst into a single UserDefaults
    // mutation while the in-memory cache still reflects the latest value
    // immediately (consumers see changes without waiting for the timer).
    // Callers that need the blob on disk right now — shutdown, tests
    // reading `defaults.data(forKey:)` directly — call `flush()`.
    static let debounceInterval: Duration = .milliseconds(250)
    private let defaults: UserDefaults
    private var cached: AppSettings
    private(set) var loadFailed = false
    private var pendingData: Data?
    private var debounceTask: Task<Void, Never>?
    // Test seam: number of `defaults.set(_:forKey:)` calls this repository has
    // performed. Read-only outside the type so regression tests can prove that
    // N rapid save()s coalesced into exactly one write.
    private(set) var writeCount = 0

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

    // Normalize + encode + cache update stay synchronous so callers observe
    // the new AppSettings — and any encoding error — the moment save()
    // returns. Only the UserDefaults write itself is deferred; use flush()
    // when you must read the persisted blob on disk immediately.
    func save(_ settings: AppSettings) throws {
        var normalized = settings
        normalized.normalize()
        let data = try JSONEncoder().encode(normalized)
        cached = normalized
        scheduleWrite(data: data)
    }

    /// Persist any pending debounced write immediately and cancel the timer.
    /// Idempotent and safe to call from shutdown paths; a no-op when nothing
    /// is queued. Required whenever a caller must see the settings blob land
    /// in UserDefaults before proceeding (app termination, tests that assert
    /// on `defaults.data(forKey:)` directly).
    func flush() {
        debounceTask?.cancel()
        debounceTask = nil
        guard let data = pendingData else { return }
        commit(data)
    }

    func update(_ mutation: (inout AppSettings) -> Void) throws -> AppSettings {
        var next = cached
        mutation(&next)
        try save(next)
        return cached
    }

    private func scheduleWrite(data: Data) {
        pendingData = data
        debounceTask?.cancel()
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: Self.debounceInterval)
            guard !Task.isCancelled, let self else { return }
            self.commitPending()
        }
    }

    private func commitPending() {
        // A concurrent flush() (e.g., shutdown racing the timer wake) may have
        // already written pendingData and cleared it; the guard makes the
        // timer path a no-op in that case. All state is MainActor-isolated,
        // so no lock is needed — flush() and this method serialize naturally.
        defer { debounceTask = nil }
        guard let data = pendingData else { return }
        commit(data)
    }

    private func commit(_ data: Data) {
        defaults.set(data, forKey: Self.storageKey)
        pendingData = nil
        writeCount += 1
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
