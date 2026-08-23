import Foundation
import OSLog

enum DiagnosticLevel: String, Sendable {
    case debug
    case info
    case warning
    case error
}

actor DebugLogStore {
    private let logger = Logger(subsystem: "com.mouthpiece.app", category: "application")
    private let directory: URL
    private let fileManager: FileManager
    private let retention: TimeInterval
    private let maximumFiles: Int
    private let maximumFileBytes: Int
    private var fileURL: URL?
    private var fileHandle: FileHandle?
    private var bytesWritten: Int = 0
    private var lastPruneDate: Date?
    private var enabled: Bool

    init(
        enabled: Bool,
        directory: URL = AppPaths.logsDirectory,
        fileManager: FileManager = .default,
        retention: TimeInterval = 7 * 24 * 60 * 60,
        maximumFiles: Int = 20,
        maximumFileBytes: Int = 4 * 1024 * 1024
    ) {
        self.enabled = enabled
        self.directory = directory
        self.fileManager = fileManager
        self.retention = retention
        self.maximumFiles = maximumFiles
        self.maximumFileBytes = maximumFileBytes
    }

    func setEnabled(_ value: Bool) {
        enabled = value
        if !value {
            try? fileHandle?.close()
            fileHandle = nil
            fileURL = nil
            bytesWritten = 0
        }
    }

    func write(
        _ level: DiagnosticLevel,
        _ message: String,
        metadata: [String: String] = [:],
        sessionID: UUID? = nil,
        now: Date = Date()
    ) {
        // With debug logging off nothing may be logged at all — the OSLog
        // lines below land in the system unified log (readable via
        // Console.app), which users reasonably expect the toggle to silence.
        guard enabled else { return }
        let cleanMessage = LogRedactor.redact(message)
        switch level {
        case .debug: logger.debug("\(cleanMessage, privacy: .public)")
        case .info: logger.info("\(cleanMessage, privacy: .public)")
        case .warning: logger.warning("\(cleanMessage, privacy: .public)")
        case .error: logger.error("\(cleanMessage, privacy: .public)")
        }
        do {
            try prepareIfNeeded(now: now)
            let cleanMetadata = metadata.mapValues(LogRedactor.redact)
            let payload = LogEntry(
                timestamp: now,
                level: level.rawValue,
                message: cleanMessage,
                metadata: cleanMetadata,
                sessionID: sessionID
            )
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            var data = try encoder.encode(payload)
            data.append(0x0A)
            try rollActiveFileIfNeeded(pendingBytes: data.count, now: now)
            guard let fileHandle else { return }
            try fileHandle.write(contentsOf: data)
            bytesWritten += data.count
        } catch {
            logger.error("Failed to write debug log: \(error.localizedDescription, privacy: .public)")
        }
    }

    func prune(now: Date = Date()) throws {
        guard fileManager.fileExists(atPath: directory.path) else { return }
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .contentModificationDateKey]
        let files = try fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        ).filter { $0.lastPathComponent.hasPrefix("debug-") && $0.pathExtension == "log" }
        let sorted = files.sorted {
            let left = (try? $0.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            return left > right
        }
        for (index, file) in sorted.enumerated() {
            // Never delete the file our persistent handle is writing to.
            if file == fileURL { continue }
            let modified = (try? file.resourceValues(forKeys: keys).contentModificationDate) ?? .distantPast
            if now.timeIntervalSince(modified) > retention || index >= maximumFiles {
                try? fileManager.removeItem(at: file)
            }
        }
        lastPruneDate = now
    }

    private func prepareIfNeeded(now: Date) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        if lastPruneDate.map({ !Calendar.current.isDate($0, inSameDayAs: now) }) ?? true {
            try prune(now: now)
        }
        if fileURL == nil {
            let formatter = ISO8601DateFormatter()
            let name = formatter.string(from: now).replacingOccurrences(of: ":", with: "-")
            let url = directory.appendingPathComponent("debug-\(name).log")
            fileManager.createFile(atPath: url.path, contents: nil)
            let handle = try FileHandle(forWritingTo: url)
            let end = try handle.seekToEnd()
            fileURL = url
            fileHandle = handle
            bytesWritten = Int(end)
        }
    }

    // P2-11: cap the active file at `maximumFileBytes` (default ~4 MB). Menu-bar
    // apps run for weeks; without this the single active file grew unbounded
    // because `prune()` only ever deletes NON-active files.
    private func rollActiveFileIfNeeded(pendingBytes: Int, now: Date) throws {
        guard let handle = fileHandle, let url = fileURL else { return }
        // Skip when the file is still empty: rolling an empty file cannot
        // satisfy an oversize single record and would just spin.
        guard bytesWritten > 0, bytesWritten + pendingBytes > maximumFileBytes else { return }
        try handle.close()
        let archive = uniqueArchiveURL(for: url)
        try fileManager.moveItem(at: url, to: archive)
        fileHandle = nil
        fileURL = nil
        bytesWritten = 0
        try prepareIfNeeded(now: now)
    }

    // Rename target has a `-rolled` suffix so the next `prepareIfNeeded` can
    // safely reopen the same `debug-<ts>.log` path even inside the same
    // ISO-8601 second (busy bursts / tests). A numeric suffix breaks
    // sub-second collisions between multiple rolls.
    private func uniqueArchiveURL(for active: URL) -> URL {
        let base = active.deletingPathExtension().lastPathComponent
        let dir = active.deletingLastPathComponent()
        var candidate = dir.appendingPathComponent("\(base)-rolled.log")
        var seq = 1
        while fileManager.fileExists(atPath: candidate.path) {
            candidate = dir.appendingPathComponent("\(base)-rolled-\(seq).log")
            seq += 1
        }
        return candidate
    }
}

private struct LogEntry: Codable {
    let timestamp: Date
    let level: String
    let message: String
    let metadata: [String: String]
    let sessionID: UUID?
}

enum LogRedactor {
    private static let patterns: [(String, String)] = [
        (#"(?i)Bearer\s+[A-Za-z0-9._~+\-/]+=*"#, "Bearer [REDACTED]"),
        (#"\bsk-[A-Za-z0-9_-]{8,}\b"#, "[REDACTED_API_KEY]"),
        // Vendor-prefixed keys (Gemini AIza…, Groq gsk_…) have distinctive
        // prefixes plus a long tail, so plain prose is not matched.
        (#"\bAIza[0-9A-Za-z_\-]{20,}"#, "[REDACTED_API_KEY]"),
        (#"\bgsk_[A-Za-z0-9]{20,}"#, "[REDACTED_API_KEY]"),
        // URL query credentials: keep the parameter name, drop only the value,
        // and stop at the next & so sibling parameters survive.
        (#"([?&](?:key|api_key|token)=)[^&\s"']+"#, "$1[REDACTED]"),
        (#"(?i)(api[_-]?key|token|authorization)([\"'\s:=]+)[^\s,}\"]+"#, "$1$2[REDACTED]"),
        (#"/Users/[^/\s]+"#, "~/Users/[REDACTED]"),
    ]

    static func redact(_ value: String) -> String {
        patterns.reduce(value) { output, pair in
            output.replacingOccurrences(
                of: pair.0,
                with: pair.1,
                options: .regularExpression
            )
        }
    }
}
