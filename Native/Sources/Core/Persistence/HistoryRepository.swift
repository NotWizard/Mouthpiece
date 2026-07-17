import Foundation
import SQLite3

struct TranscriptionRecord: Identifiable, Equatable, Sendable {
    let id: Int64
    let text: String
    let rawText: String?
    let timestamp: Date
}

enum HistoryRepositoryError: LocalizedError {
    case sqlite(message: String)

    var errorDescription: String? {
        switch self {
        case .sqlite(let message): message
        }
    }
}

actor HistoryRepository {
    private let connection: SQLiteConnection
    private let databaseURL: URL
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private var database: OpaquePointer? { connection.pointer }

    init(databaseURL: URL = AppPaths.databaseURL) throws {
        self.databaseURL = databaseURL
        try FileManager.default.createDirectory(
            at: databaseURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        var handle: OpaquePointer?
        guard sqlite3_open_v2(
            databaseURL.path,
            &handle,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX,
            nil
        ) == SQLITE_OK else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open database"
            if let handle { sqlite3_close(handle) }
            throw HistoryRepositoryError.sqlite(message: message)
        }
        connection = SQLiteConnection(pointer: handle)
        try Self.configureAndMigrate(handle)
    }

    func save(text: String, rawText: String?) throws -> TranscriptionRecord {
        let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanText.isEmpty else {
            throw HistoryRepositoryError.sqlite(message: "Cannot save an empty transcription")
        }
        let sql = "INSERT INTO transcriptions (text, raw_text) VALUES (?, ?)"
        let statement = try prepare(sql)
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, cleanText, -1, Self.transient)
        if let rawText {
            sqlite3_bind_text(statement, 2, rawText, -1, Self.transient)
        } else {
            sqlite3_bind_null(statement, 2)
        }
        try stepDone(statement)
        return try record(id: sqlite3_last_insert_rowid(database))
    }

    func recent(limit: Int = 50) throws -> [TranscriptionRecord] {
        let statement = try prepare(
            "SELECT id, text, raw_text, timestamp FROM transcriptions ORDER BY timestamp DESC LIMIT ?"
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int(statement, 1, Int32(max(1, min(limit, 1_000))))
        var records: [TranscriptionRecord] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                records.append(Self.decodeRecord(statement))
            case SQLITE_DONE:
                return records
            default:
                throw currentError()
            }
        }
    }

    func delete(id: Int64) throws {
        let statement = try prepare("DELETE FROM transcriptions WHERE id = ?")
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, id)
        try stepDone(statement)
    }

    func restore(_ record: TranscriptionRecord) throws {
        let statement = try prepare(
            "INSERT OR REPLACE INTO transcriptions (id, text, raw_text, timestamp) VALUES (?, ?, ?, ?)"
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, record.id)
        sqlite3_bind_text(statement, 2, record.text, -1, Self.transient)
        if let rawText = record.rawText {
            sqlite3_bind_text(statement, 3, rawText, -1, Self.transient)
        } else {
            sqlite3_bind_null(statement, 3)
        }
        sqlite3_bind_text(statement, 4, SQLiteDateParser.string(from: record.timestamp), -1, Self.transient)
        try stepDone(statement)
    }

    func clear() throws {
        try execute("DELETE FROM transcriptions")
    }

    func dictionary() throws -> [String] {
        let statement = try prepare("SELECT word FROM custom_dictionary ORDER BY id ASC")
        defer { sqlite3_finalize(statement) }
        var words: [String] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                if let value = sqlite3_column_text(statement, 0) {
                    words.append(String(cString: value))
                }
            case SQLITE_DONE:
                return words
            default:
                throw currentError()
            }
        }
    }

    func replaceDictionary(_ words: [String]) throws {
        try execute("BEGIN IMMEDIATE TRANSACTION")
        do {
            try execute("DELETE FROM custom_dictionary")
            let statement = try prepare("INSERT OR IGNORE INTO custom_dictionary (word) VALUES (?)")
            defer { sqlite3_finalize(statement) }
            for word in words {
                let clean = word.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !clean.isEmpty else { continue }
                sqlite3_reset(statement)
                sqlite3_clear_bindings(statement)
                sqlite3_bind_text(statement, 1, clean, -1, Self.transient)
                try stepDone(statement)
            }
            try execute("COMMIT")
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func record(id: Int64) throws -> TranscriptionRecord {
        let statement = try prepare(
            "SELECT id, text, raw_text, timestamp FROM transcriptions WHERE id = ?"
        )
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_int64(statement, 1, id)
        let result = sqlite3_step(statement)
        guard result == SQLITE_ROW else {
            if result != SQLITE_DONE { throw currentError() }
            throw HistoryRepositoryError.sqlite(message: "Inserted transcription could not be read")
        }
        return Self.decodeRecord(statement)
    }

    private static func decodeRecord(_ statement: OpaquePointer?) -> TranscriptionRecord {
        let id = sqlite3_column_int64(statement, 0)
        let text = sqlite3_column_text(statement, 1).map { String(cString: $0) } ?? ""
        let rawText = sqlite3_column_text(statement, 2).map { String(cString: $0) }
        let timestampText = sqlite3_column_text(statement, 3).map { String(cString: $0) } ?? ""
        return TranscriptionRecord(
            id: id,
            text: text,
            rawText: rawText,
            timestamp: SQLiteDateParser.date(from: timestampText)
        )
    }

    private static func configureAndMigrate(_ database: OpaquePointer?) throws {
        try execute(database, "PRAGMA journal_mode=WAL")
        try execute(database, "PRAGMA foreign_keys=ON")
        try execute(database, """
            CREATE TABLE IF NOT EXISTS transcriptions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              text TEXT NOT NULL,
              raw_text TEXT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """)
        let transcriptionColumns = try columnNames(database, table: "transcriptions")
        if !transcriptionColumns.contains("raw_text") {
            try execute(database, "ALTER TABLE transcriptions ADD COLUMN raw_text TEXT")
        }
        try execute(
            database,
            "CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp ON transcriptions(timestamp DESC)"
        )
        try execute(database, """
            CREATE TABLE IF NOT EXISTS custom_dictionary (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              word TEXT NOT NULL UNIQUE,
              created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            """)
    }

    private static func columnNames(_ database: OpaquePointer?, table: String) throws -> Set<String> {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "PRAGMA table_info(\(table))", -1, &statement, nil) == SQLITE_OK else {
            throw HistoryRepositoryError.sqlite(
                message: database.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite error"
            )
        }
        defer { sqlite3_finalize(statement) }
        var names = Set<String>()
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                if let name = sqlite3_column_text(statement, 1) {
                    names.insert(String(cString: name))
                }
            case SQLITE_DONE:
                return names
            default:
                throw HistoryRepositoryError.sqlite(
                    message: database.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite error"
                )
            }
        }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer? {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK else {
            throw currentError()
        }
        return statement
    }

    private func stepDone(_ statement: OpaquePointer?) throws {
        guard sqlite3_step(statement) == SQLITE_DONE else { throw currentError() }
    }

    private func execute(_ sql: String) throws {
        try Self.execute(database, sql)
    }

    private static func execute(_ database: OpaquePointer?, _ sql: String) throws {
        var errorMessage: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(database, sql, nil, nil, &errorMessage) == SQLITE_OK else {
            let message = errorMessage.map { String(cString: $0) } ?? "SQLite error"
            sqlite3_free(errorMessage)
            throw HistoryRepositoryError.sqlite(message: message)
        }
    }

    private func currentError() -> HistoryRepositoryError {
        .sqlite(message: database.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite error")
    }
}

private final class SQLiteConnection: @unchecked Sendable {
    let pointer: OpaquePointer?

    init(pointer: OpaquePointer?) {
        self.pointer = pointer
    }

    deinit {
        if let pointer { sqlite3_close(pointer) }
    }
}

private enum SQLiteDateParser {
    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    static func date(from value: String) -> Date {
        formatter.date(from: value) ?? .distantPast
    }

    static func string(from value: Date) -> String {
        formatter.string(from: value)
    }
}
