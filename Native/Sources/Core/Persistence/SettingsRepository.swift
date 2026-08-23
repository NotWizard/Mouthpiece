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
    // P2-8: when the strict decode below rejects a stored blob because one or
    // more fields have the wrong JSON type, keep the pre-corruption bytes
    // under this prefix + epoch-seconds so a user or support engineer can
    // still recover the original state after the next save() overwrites the
    // primary key. The corrupt-blob writes deliberately go through a
    // different key, so `writeCount` (a primary-key seam) is unaffected.
    private static let corruptBlobKeyPrefix = "native.settings.v1.corrupt."
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
    // performed against the primary storage key. Read-only outside the type so
    // regression tests can prove that N rapid save()s coalesced into exactly
    // one write. The corrupt-blob backup path writes to a distinct key and
    // deliberately does NOT increment this counter.
    private(set) var writeCount = 0

    init(defaults: UserDefaults? = nil) {
        let defaults = defaults ?? Self.defaultStore()
        self.defaults = defaults
        guard let data = defaults.data(forKey: Self.storageKey) else {
            cached = AppSettings()
            return
        }
        // P2-8: on HEAD a single wrong-typed field made JSONDecoder fail
        // atomically and silently revert EVERY field to its default. The
        // decode is now a two-pass strict-then-tolerant sequence, and the
        // caller here treats the three outcomes separately.
        switch Self.decodeWithDefaults(data) {
        case .strict(var decoded):
            decoded.normalize()
            cached = decoded
        case .tolerated(var decoded):
            // Strict decode rejected at least one field but the tolerant pass
            // kept every well-typed field and defaulted only the mismatched
            // ones. Archive the pre-corruption bytes so the next save() cannot
            // silently lose them.
            Self.backupCorruptBlob(data, in: defaults)
            decoded.normalize()
            cached = decoded
        case .unrecoverable:
            // Non-JSON payload, or a JSON payload whose top-level shape is not
            // an object: preserve the raw bytes at the primary key (so the
            // UI's loadFailed warning can offer manual recovery) AND back
            // them up under the corrupt-blob prefix so the next save() cannot
            // erase them.
            Logger(subsystem: "com.mouthpiece.app", category: "settings")
                .error("Stored settings failed to decode (\(data.count) bytes); using defaults")
            Self.backupCorruptBlob(data, in: defaults)
            loadFailed = true
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

    // P2-8: two-pass decode outcome.
    //   .strict        — every stored field's JSON type matched the AppSettings
    //                    expectation, so the merge-with-defaults strict decode
    //                    succeeded exactly as before this fix.
    //   .tolerated     — the strict decode rejected the blob but a per-field
    //                    type-tolerant fallback (defaulting the mismatched
    //                    leaves) recovered a usable AppSettings; the caller is
    //                    responsible for archiving the original bytes.
    //   .unrecoverable — even the tolerant pass could not decode (non-JSON
    //                    payload, top-level shape is not an object, or a
    //                    structural mismatch the shallow shape check cannot
    //                    smooth over); caller must set loadFailed and archive
    //                    the original bytes.
    private enum DecodeResult {
        case strict(AppSettings)
        case tolerated(AppSettings)
        case unrecoverable
    }

    private static func decodeWithDefaults(_ data: Data) -> DecodeResult {
        guard let defaultDict = try? JSONSerialization.jsonObject(
            with: JSONEncoder().encode(AppSettings())
        ) as? [String: Any] else {
            return .unrecoverable
        }
        guard let storedDict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            // The stored blob is not a JSON object (non-JSON payload, a JSON
            // array, etc.) — no per-field merge is possible.
            return .unrecoverable
        }
        // Pass 1: existing merge-with-defaults + strict JSONDecoder decode.
        // Handles forward-compatible schema drift (older blobs missing new
        // fields) because the merge fills defaults for absent keys before
        // decoding. Fails atomically on any type mismatch — exactly the
        // regression P2-8 replaces.
        let strictMerged = merge(
            defaults: defaultDict,
            stored: storedDict,
            tolerateTypeMismatches: false
        )
        if let mergedData = try? JSONSerialization.data(withJSONObject: strictMerged),
           let decoded = try? JSONDecoder().decode(AppSettings.self, from: mergedData) {
            return .strict(decoded)
        }
        // Pass 2: replace every leaf whose stored JSON type disagrees with
        // the default's JSON type by the default value, so a single wrong-
        // typed field degrades ONLY that field. Structural JSON matching
        // (string / number / bool / array / dict / null) is the practical
        // granularity here; deeper mismatches (e.g. a wrong-typed element
        // inside an array-of-string) still fall through to .unrecoverable,
        // which is acceptable per P2-8's stated scope.
        let sanitized = merge(
            defaults: defaultDict,
            stored: storedDict,
            tolerateTypeMismatches: true
        )
        guard let sanitizedData = try? JSONSerialization.data(withJSONObject: sanitized),
              let decoded = try? JSONDecoder().decode(AppSettings.self, from: sanitizedData) else {
            return .unrecoverable
        }
        return .tolerated(decoded)
    }

    private static func merge(
        defaults: [String: Any],
        stored: [String: Any],
        tolerateTypeMismatches: Bool
    ) -> [String: Any] {
        var combined = defaults
        for (key, value) in stored {
            if let defaultObject = defaults[key] as? [String: Any] {
                if let storedObject = value as? [String: Any] {
                    combined[key] = merge(
                        defaults: defaultObject,
                        stored: storedObject,
                        tolerateTypeMismatches: tolerateTypeMismatches
                    )
                } else if tolerateTypeMismatches {
                    // Stored value is not a dictionary where AppSettings
                    // expects one (e.g. terminologyProfile stored as "hi") —
                    // keep the default sub-tree so the enclosing struct can
                    // still decode.
                    continue
                } else {
                    combined[key] = value
                }
            } else if tolerateTypeMismatches,
                      let defaultLeaf = defaults[key],
                      !isSameJSONType(defaultLeaf, value) {
                // Leaf-level type mismatch: keep the default. Only fires in
                // the Pass 2 tolerant pass; Pass 1 leaves the mismatched
                // value in place so the strict decoder can reject it.
                continue
            } else {
                combined[key] = value
            }
        }
        return combined
    }

    // P2-8: JSONSerialization decodes both JSON numbers and JSON booleans as
    // NSNumber (JSON bool bridges from kCFBoolean{True,False}), so `is
    // NSNumber` alone cannot separate them. Compare CFTypeIDs to distinguish.
    // The other JSON kinds (string, array, object, null) map cleanly to
    // Swift/ObjC bridged types.
    private static func isSameJSONType(_ a: Any, _ b: Any) -> Bool {
        let aIsBool = CFGetTypeID(a as CFTypeRef) == CFBooleanGetTypeID()
        let bIsBool = CFGetTypeID(b as CFTypeRef) == CFBooleanGetTypeID()
        if aIsBool != bIsBool { return false }
        if aIsBool { return true }
        if a is NSNumber && b is NSNumber { return true }
        if a is String && b is String { return true }
        if a is [Any] && b is [Any] { return true }
        if a is [String: Any] && b is [String: Any] { return true }
        if a is NSNull && b is NSNull { return true }
        return false
    }

    private static func backupCorruptBlob(_ data: Data, in defaults: UserDefaults) {
        let epoch = Int(Date().timeIntervalSince1970)
        let key = "\(Self.corruptBlobKeyPrefix)\(epoch)"
        // Idempotent under same-second collisions: keep the first backup so a
        // rapid re-init cannot clobber the pre-corruption bytes.
        guard defaults.data(forKey: key) == nil else { return }
        defaults.set(data, forKey: key)
    }

}
