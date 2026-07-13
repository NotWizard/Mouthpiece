import Foundation
import swift_leveldb

enum LegacyLocalStorageError: LocalizedError {
    case malformedBatch

    var errorDescription: String? { "The legacy Chromium settings database is malformed." }
}

struct LegacyLocalStorageImporter: Sendable {
    func read(levelDBDirectory: URL) throws -> [String: String] {
        if let values = try? readDatabaseCopy(levelDBDirectory), !values.isEmpty {
            return values
        }
        return try readLogFiles(levelDBDirectory)
    }

    private func readDatabaseCopy(_ source: URL) throws -> [String: String] {
        let temporaryRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-LevelDB-\(UUID().uuidString)", isDirectory: true)
        let copy = temporaryRoot.appendingPathComponent("leveldb", isDirectory: true)
        try FileManager.default.createDirectory(at: temporaryRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporaryRoot) }
        try FileManager.default.copyItem(at: source, to: copy)
        try? FileManager.default.removeItem(at: copy.appendingPathComponent("LOCK"))

        let database = try Database(
            path: copy.path,
            options: .init(createIfMissing: false, paranoidChecks: true)
        )
        let iterator = database.iterator(readOptions: .init(verifyChecksums: true, fillCache: false))
        iterator.seekToFirst()
        var values: [String: String] = [:]
        while iterator.isValid {
            if let keyData = iterator.key,
               let valueData = iterator.value,
               let key = decodeChromiumKey(keyData),
               let value = decodeChromiumString(valueData) {
                values[key] = value
            }
            iterator.next()
        }
        try iterator.checkError()
        return values
    }

    private func readLogFiles(_ levelDBDirectory: URL) throws -> [String: String] {
        let logs = try FileManager.default.contentsOfDirectory(
            at: levelDBDirectory,
            includingPropertiesForKeys: nil
        )
        .filter { $0.pathExtension == "log" }
        .sorted { $0.lastPathComponent < $1.lastPathComponent }
        var values: [String: String] = [:]
        for log in logs {
            let changes = try parseLogData(Data(contentsOf: log))
            for (key, value) in changes {
                if let value { values[key] = value } else { values.removeValue(forKey: key) }
            }
        }
        return values
    }

    func parseLogData(_ data: Data) throws -> [String: String?] {
        let blockSize = 32_768
        var changes: [String: String?] = [:]
        var fragmented = Data()

        for blockStart in stride(from: 0, to: data.count, by: blockSize) {
            let blockEnd = min(blockStart + blockSize, data.count)
            var offset = blockStart
            while offset + 7 <= blockEnd {
                let length = Int(data[offset + 4]) | (Int(data[offset + 5]) << 8)
                let type = data[offset + 6]
                if length == 0 && type == 0 { break }
                let payloadStart = offset + 7
                let payloadEnd = payloadStart + length
                guard payloadEnd <= blockEnd else { break }
                let payload = data[payloadStart..<payloadEnd]
                switch type {
                case 1:
                    try applyWriteBatch(Data(payload), to: &changes)
                case 2:
                    fragmented = Data(payload)
                case 3:
                    fragmented.append(payload)
                case 4:
                    fragmented.append(payload)
                    try applyWriteBatch(fragmented, to: &changes)
                    fragmented.removeAll(keepingCapacity: true)
                default:
                    break
                }
                offset = payloadEnd
            }
        }
        return changes
    }

    private func applyWriteBatch(_ data: Data, to changes: inout [String: String?]) throws {
        guard data.count >= 12 else { throw LegacyLocalStorageError.malformedBatch }
        var cursor = 12
        let expectedCount = Int(data.readUInt32LittleEndian(at: 8))
        var parsedCount = 0
        while cursor < data.count, parsedCount < expectedCount {
            let tag = data[cursor]
            cursor += 1
            let keyData = try readLengthPrefixed(data, cursor: &cursor)
            guard let key = decodeChromiumKey(keyData) else {
                if tag == 1 { _ = try readLengthPrefixed(data, cursor: &cursor) }
                parsedCount += 1
                continue
            }
            if tag == 0 {
                changes[key] = .some(nil)
            } else if tag == 1 {
                let valueData = try readLengthPrefixed(data, cursor: &cursor)
                changes[key] = decodeChromiumString(valueData)
            } else {
                throw LegacyLocalStorageError.malformedBatch
            }
            parsedCount += 1
        }
        guard parsedCount == expectedCount else { throw LegacyLocalStorageError.malformedBatch }
    }

    private func readLengthPrefixed(_ data: Data, cursor: inout Int) throws -> Data {
        let length = try readVarint(data, cursor: &cursor)
        guard length >= 0, cursor + length <= data.count else {
            throw LegacyLocalStorageError.malformedBatch
        }
        defer { cursor += length }
        return Data(data[cursor..<(cursor + length)])
    }

    private func readVarint(_ data: Data, cursor: inout Int) throws -> Int {
        var result = 0
        var shift = 0
        while cursor < data.count, shift <= 28 {
            let byte = data[cursor]
            cursor += 1
            result |= Int(byte & 0x7f) << shift
            if byte & 0x80 == 0 { return result }
            shift += 7
        }
        throw LegacyLocalStorageError.malformedBatch
    }

    private func decodeChromiumKey(_ data: Data) -> String? {
        guard let separator = data.lastIndex(of: 0), separator + 1 < data.count else { return nil }
        let origin = String(decoding: data[..<separator], as: UTF8.self)
        guard origin == "_file://" else { return nil }
        return decodeChromiumString(Data(data[(separator + 1)...]))
    }

    private func decodeChromiumString(_ data: Data) -> String? {
        guard let encoding = data.first else { return "" }
        let contents = data.dropFirst()
        switch encoding {
        case 0:
            return String(data: contents, encoding: .utf16LittleEndian)
        case 1:
            return String(data: contents, encoding: .utf8)
        default:
            return String(data: data, encoding: .utf8)
        }
    }
}

private extension Data {
    func readUInt32LittleEndian(at offset: Int) -> UInt32 {
        UInt32(self[offset])
            | (UInt32(self[offset + 1]) << 8)
            | (UInt32(self[offset + 2]) << 16)
            | (UInt32(self[offset + 3]) << 24)
    }
}
