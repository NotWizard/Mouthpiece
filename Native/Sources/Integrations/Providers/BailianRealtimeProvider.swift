import Foundation
import OSLog

enum BailianASRModel: String, CaseIterable, Sendable {
    case qwenAudio3 = "qwen-audio-3.0-asr-flash-streaming"
    case funASR = "fun-asr-realtime"

    static let defaultModel: Self = .qwenAudio3

    var titleKey: String {
        switch self {
        case .qwenAudio3: "speech.bailianModel.qwenAudio3"
        case .funASR: "speech.bailianModel.funASR"
        }
    }

    var helpKey: String {
        switch self {
        case .qwenAudio3: "speech.bailianModel.qwenAudio3.help"
        case .funASR: "speech.bailianModel.funASR.help"
        }
    }
}

enum BailianRealtimeError: LocalizedError, Equatable {
    case missingAPIKey
    case timedOut
    case connectionLost(String)
    case protocolError(String)
    case unsupportedModel(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey: "Alibaba Bailian API key is required."
        case .timedOut: "Alibaba Bailian realtime connection timed out."
        case .connectionLost(let reason): "Connection lost (\(reason))."
        case .protocolError(let message): message
        case .unsupportedModel(let model): "Unsupported Alibaba Bailian realtime model: \(model)."
        }
    }
}

actor BailianRealtimeProvider: RealtimeTranscriptionProvider {
    static let endpoint = URL(string: "wss://dashscope.aliyuncs.com/api-ws/v1/inference/")!
    static let defaultModel = BailianASRModel.defaultModel.rawValue

    private let session: URLSession
    private let vocabularyService: BailianVocabularyService
    private var socket: URLSessionWebSocketTask?
    private var configuration: RealtimeTranscriptionConfiguration?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var receiveTask: Task<Void, Never>?
    private var generation = 0
    private var taskID = ""
    private var taskStarted = false
    private var taskFinished = false
    private var warmCreatedAt: Date?
    private var pendingAudio = Data()
    private var committedText = ""
    private var activeText = ""
    private var completedSentenceBegins = Set<Int>()

    private let networkChunkBytes = 3_200
    private let warmTTL: TimeInterval = 5 * 60

    init(session: URLSession = .shared) {
        self.session = session
        self.vocabularyService = BailianVocabularyService(session: session)
    }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {
        guard !configuration.apiKey.isEmpty else { throw BailianRealtimeError.missingAPIKey }
        if taskStarted,
           self.configuration == configuration,
           let warmCreatedAt,
           Date().timeIntervalSince(warmCreatedAt) < warmTTL,
           socket?.state == .running {
            return
        }
        await closeSocket()
        try await createTask(configuration)
        warmCreatedAt = Date()
    }

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        guard !configuration.apiKey.isEmpty else { throw BailianRealtimeError.missingAPIKey }
        resetTranscript()
        eventHandler = onEvent

        let canUseWarm = taskStarted
            && self.configuration == configuration
            && warmCreatedAt.map { Date().timeIntervalSince($0) < warmTTL } == true
            && socket?.state == .running
        if !canUseWarm {
            await closeSocket()
            try await createTask(configuration)
        }
        self.configuration = configuration
        warmCreatedAt = nil
        startReceiveLoop()
    }

    func send(pcm16: Data) async throws {
        guard !pcm16.isEmpty else { return }
        guard taskStarted, let socket, socket.state == .running else {
            pendingAudio.append(pcm16)
            let maximumPendingBytes = 3 * 16_000 * 2
            if pendingAudio.count > maximumPendingBytes {
                pendingAudio.removeFirst(pendingAudio.count - maximumPendingBytes)
            }
            return
        }
        pendingAudio.append(pcm16)
        guard pendingAudio.count >= networkChunkBytes else { return }
        // Detach whole chunks before awaiting so a reentrant call sees a
        // consistent buffer.
        let outgoing = Self.detachSendableChunks(from: &pendingAudio, chunkBytes: networkChunkBytes)
        var offset = 0
        while offset < outgoing.count {
            let chunk = outgoing.subdata(in: offset..<(offset + networkChunkBytes))
            do {
                try await socket.send(.data(chunk))
            } catch {
                pendingAudio = outgoing.subdata(in: offset..<outgoing.count) + pendingAudio
                throw error
            }
            offset += networkChunkBytes
        }
    }

    // Data(prefix)/Data(dropFirst) rebuild fresh zero-based Data: after
    // removeFirst, Data.startIndex is no longer 0, so zero-based
    // subdata/insert would trap on the next flush.
    static func detachSendableChunks(from buffer: inout Data, chunkBytes: Int) -> Data {
        let sendableCount = (buffer.count / chunkBytes) * chunkBytes
        guard sendableCount > 0 else { return Data() }
        let outgoing = Data(buffer.prefix(sendableCount))
        buffer = Data(buffer.dropFirst(sendableCount))
        return outgoing
    }

    func finish() async throws -> String {
        guard let socket, taskStarted, socket.state == .running else {
            throw BailianRealtimeError.connectionLost("Bailian realtime task is not active")
        }
        let expectedGeneration = generation
        if !pendingAudio.isEmpty {
            try await socket.send(.data(pendingAudio))
            pendingAudio.removeAll(keepingCapacity: true)
        }
        try await sendJSON(finishTask(), over: socket)
        try ensureCurrent(socket: socket, generation: expectedGeneration)

        let deadline = ContinuousClock.now + .seconds(5)
        while !taskFinished && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(40))
            try ensureCurrent(socket: socket, generation: expectedGeneration)
        }
        guard taskFinished else { throw BailianRealtimeError.timedOut }
        let text = resolvedText
        await closeSocket()
        return text
    }

    func cancel() async {
        await closeSocket()
        resetTranscript()
    }

    private func createTask(_ configuration: RealtimeTranscriptionConfiguration) async throws {
        guard let model = BailianASRModel(rawValue: configuration.model) else {
            throw BailianRealtimeError.unsupportedModel(configuration.model)
        }
        var request = URLRequest(url: Self.endpoint)
        request.timeoutInterval = 30
        request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("enable", forHTTPHeaderField: "X-DashScope-DataInspection")
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        self.configuration = configuration
        generation += 1
        let expectedGeneration = generation
        taskID = Self.makeTaskID()
        taskStarted = false
        taskFinished = false
        socket.resume()

        do {
            var vocabularyID: String?
            if model == .funASR {
                do {
                    vocabularyID = try await vocabularyService.vocabularyID(
                        apiKey: configuration.apiKey,
                        terms: configuration.preferredTerms
                    )
                } catch {
                    // The session still works without hot words; just stop hiding why.
                    Logger(subsystem: "com.mouthpiece.app", category: "bailian")
                        .warning("Vocabulary sync failed: \(error.localizedDescription, privacy: .public)")
                }
            }
            try ensureCurrent(socket: socket, generation: expectedGeneration)
            try await sendJSON(
                Self.runTaskPayload(
                    taskID: taskID,
                    configuration: configuration,
                    model: model,
                    vocabularyID: vocabularyID
                ),
                over: socket
            )

            let deadline = ContinuousClock.now + .seconds(30)
            while ContinuousClock.now < deadline {
                let message = try await socket.receive(timeout: .seconds(30))
                try ensureCurrent(socket: socket, generation: expectedGeneration)
                guard let payload = BailianMessageParser.payload(from: message) else { continue }
                switch BailianMessageParser.event(in: payload) {
                case "task-started":
                    taskStarted = true
                    return
                case "task-failed":
                    throw BailianRealtimeError.protocolError(BailianMessageParser.errorMessage(payload))
                default:
                    continue
                }
            }
            throw BailianRealtimeError.timedOut
        } catch {
            if isCurrent(socket: socket, generation: expectedGeneration) { await closeSocket() }
            throw error
        }
    }

    private func startReceiveLoop() {
        receiveTask?.cancel()
        let expectedGeneration = generation
        receiveTask = Task { [weak self] in
            guard let self else { return }
            await self.receiveLoop(expectedGeneration: expectedGeneration)
        }
    }

    private func receiveLoop(expectedGeneration: Int) async {
        guard let socket else { return }
        do {
            while !Task.isCancelled, expectedGeneration == generation {
                let message = try await socket.receive(timeout: .seconds(60))
                guard isCurrent(socket: socket, generation: expectedGeneration), !Task.isCancelled else {
                    return
                }
                guard let payload = BailianMessageParser.payload(from: message) else { continue }
                handle(payload)
            }
        } catch {
            guard !Task.isCancelled, expectedGeneration == generation else { return }
            eventHandler?(.error(
                BailianRealtimeError.connectionLost(error.localizedDescription).localizedDescription
            ))
        }
    }

    private func handle(_ payload: [String: Any]) {
        switch BailianMessageParser.event(in: payload) {
        case "result-generated":
            guard let sentence = BailianMessageParser.sentence(in: payload) else { return }
            if sentence.sentenceEnd {
                activeText = ""
                if completedSentenceBegins.insert(sentence.beginTime).inserted {
                    committedText = TranscriptJoiner.join(
                        committedText,
                        sentence.displayText,
                        language: configuration?.language
                    )
                }
                eventHandler?(.final(committedText))
            } else {
                activeText = sentence.displayText
                eventHandler?(.partial(stable: committedText, active: activeText))
            }
        case "task-finished":
            taskFinished = true
            eventHandler?(.sessionFinished(resolvedText))
        case "task-failed":
            eventHandler?(.error(BailianMessageParser.errorMessage(payload)))
        default:
            break
        }
    }

    static func runTaskPayload(
        taskID: String,
        configuration: RealtimeTranscriptionConfiguration,
        model: BailianASRModel,
        vocabularyID: String?
    ) -> [String: Any] {
        var parameters: [String: Any] = [
            "format": "pcm",
            "sample_rate": configuration.sampleRate,
            "max_sentence_silence": configuration.silenceDurationMilliseconds,
        ]
        if model == .funASR, let vocabularyID, !vocabularyID.isEmpty {
            parameters["vocabulary_id"] = vocabularyID
        } else if model == .qwenAudio3 {
            let vocabulary = BailianVocabularyService.inlineVocabulary(configuration.preferredTerms)
            if !vocabulary.isEmpty {
                parameters["vocabulary"] = vocabulary
            }
        }
        return [
            "header": [
                "action": "run-task",
                "task_id": taskID,
                "streaming": "duplex",
            ],
            "payload": [
                "task_group": "audio",
                "task": "asr",
                "function": "recognition",
                "model": model.rawValue,
                "parameters": parameters,
                "input": [String: Any](),
            ],
        ]
    }

    private func finishTask() -> [String: Any] {
        Self.finishTaskPayload(taskID: taskID)
    }

    static func finishTaskPayload(taskID: String) -> [String: Any] {
        [
            "header": [
                "action": "finish-task",
                "task_id": taskID,
                "streaming": "duplex",
            ],
            "payload": [
                "input": [String: Any](),
            ],
        ]
    }

    private func sendJSON(_ payload: [String: Any], over socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let text = String(data: data, encoding: .utf8) else {
            throw BailianRealtimeError.protocolError("Unable to encode Bailian request")
        }
        try await socket.send(.string(text))
    }

    private func closeSocket() async {
        receiveTask?.cancel()
        receiveTask = nil
        generation += 1
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        taskStarted = false
        taskFinished = false
        warmCreatedAt = nil
        pendingAudio.removeAll(keepingCapacity: false)
    }

    private func ensureCurrent(socket: URLSessionWebSocketTask, generation: Int) throws {
        guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else {
            throw CancellationError()
        }
    }

    private func isCurrent(socket: URLSessionWebSocketTask, generation: Int) -> Bool {
        generation == self.generation && self.socket === socket
    }

    private func resetTranscript() {
        pendingAudio.removeAll(keepingCapacity: true)
        committedText = ""
        activeText = ""
        completedSentenceBegins.removeAll()
        taskFinished = false
    }

    private var resolvedText: String {
        TranscriptJoiner.join(committedText, activeText, language: configuration?.language)
    }

    private static func makeTaskID() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }
}

actor BailianVocabularyService {
    private static let endpoint = URL(
        string: "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/customization"
    )!
    private static let prefix = "mouthpiece"

    private let session: URLSession
    private var cachedAPIKey = ""
    private var cachedTerms: [String] = []
    private var cachedVocabularyID: String?
    private var cachedAt: Date?
    private static let cacheLifetime: TimeInterval = 30 * 60

    init(session: URLSession = .shared) {
        self.session = session
    }

    func vocabularyID(apiKey: String, terms: [String]) async throws -> String? {
        let terms = Self.normalizedTerms(terms)
        guard !terms.isEmpty else { return nil }
        // TTL guards against a server-side deleted/expired vocabulary being
        // reused forever with hot words silently ignored.
        if apiKey == cachedAPIKey, terms == cachedTerms, let cachedVocabularyID,
           let cachedAt, Date().timeIntervalSince(cachedAt) < Self.cacheLifetime {
            return cachedVocabularyID
        }

        let vocabularyID = try await existingVocabularyID(apiKey: apiKey)
        if let vocabularyID {
            _ = try await request(
                apiKey: apiKey,
                input: [
                    "action": "update_vocabulary",
                    "vocabulary_id": vocabularyID,
                    "vocabulary": Self.vocabularyEntries(terms),
                ]
            )
        } else {
            let response = try await request(
                apiKey: apiKey,
                input: [
                    "action": "create_vocabulary",
                    "target_model": BailianASRModel.funASR.rawValue,
                    "prefix": Self.prefix,
                    "vocabulary": Self.vocabularyEntries(terms),
                ]
            )
            guard let createdID = Self.output(response)["vocabulary_id"] as? String else {
                throw BailianRealtimeError.protocolError("Bailian did not return a vocabulary ID.")
            }
            cachedVocabularyID = createdID
        }

        let resolvedID = vocabularyID ?? cachedVocabularyID
        if let resolvedID {
            try await waitUntilReady(apiKey: apiKey, vocabularyID: resolvedID)
        }
        cachedTerms = terms
        cachedAPIKey = apiKey
        cachedVocabularyID = resolvedID
        cachedAt = Date()
        return resolvedID
    }

    private func existingVocabularyID(apiKey: String) async throws -> String? {
        let response = try await request(
            apiKey: apiKey,
            input: [
                "action": "list_vocabulary",
                "prefix": Self.prefix,
                "page_index": 0,
                "page_size": 10,
            ]
        )
        let output = Self.output(response)
        let values = output["vocabulary_list"] as? [[String: Any]]
            ?? output["vocabularies"] as? [[String: Any]]
            ?? []
        return values.first?["vocabulary_id"] as? String
    }

    private func waitUntilReady(apiKey: String, vocabularyID: String) async throws {
        for _ in 0..<10 {
            let response = try await request(
                apiKey: apiKey,
                input: [
                    "action": "query_vocabulary",
                    "vocabulary_id": vocabularyID,
                ]
            )
            let status = Self.output(response)["status"] as? String
            if status == nil || status == "OK" { return }
            if status == "FAILED" {
                throw BailianRealtimeError.protocolError("Bailian vocabulary synchronization failed.")
            }
            try await Task.sleep(for: .milliseconds(200))
        }
        throw BailianRealtimeError.timedOut
    }

    private func request(apiKey: String, input: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: Self.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": "speech-biasing",
            "input": input,
        ])
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown vocabulary error"
            throw BailianRealtimeError.protocolError(message)
        }
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BailianRealtimeError.protocolError("Bailian returned an invalid vocabulary response.")
        }
        return payload
    }

    private static func output(_ payload: [String: Any]) -> [String: Any] {
        payload["output"] as? [String: Any] ?? [:]
    }

    private static func vocabularyEntries(_ terms: [String]) -> [[String: Any]] {
        terms.map { ["text": $0, "weight": 4] }
    }

    static func inlineVocabulary(_ terms: [String]) -> [String: Int] {
        Dictionary(uniqueKeysWithValues: normalizedTerms(terms, limit: 2_000).map { ($0, 4) })
    }

    private static func normalizedTerms(_ terms: [String], limit: Int = 500) -> [String] {
        var seen = Set<String>()
        return terms.compactMap { value in
            let term = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !term.isEmpty, !term.contains("\n") else { return nil }
            let isASCII = term.unicodeScalars.allSatisfy(\.isASCII)
            guard isASCII ? term.split(separator: " ").count <= 7 : term.count <= 15 else { return nil }
            guard seen.insert(term.lowercased()).inserted else { return nil }
            return term
        }
        .prefix(limit)
        .map { $0 }
    }
}

struct BailianSentence: Equatable, Sendable {
    let beginTime: Int
    let endTime: Int
    let text: String
    let sentenceEnd: Bool
    let words: [BailianWord]

    var displayText: String {
        guard !words.isEmpty else { return text }
        return words.map { $0.text + $0.punctuation }.joined()
    }
}

struct BailianWord: Equatable, Sendable {
    let beginTime: Int
    let endTime: Int
    let text: String
    let punctuation: String
}

enum BailianMessageParser {
    static func payload(from message: URLSessionWebSocketTask.Message) -> [String: Any]? {
        let data: Data
        switch message {
        case .data(let value): data = value
        case .string(let value): data = Data(value.utf8)
        @unknown default: return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    static func event(in payload: [String: Any]) -> String? {
        (payload["header"] as? [String: Any])?["event"] as? String
    }

    static func sentence(in payload: [String: Any]) -> BailianSentence? {
        guard let body = payload["payload"] as? [String: Any],
              let output = body["output"] as? [String: Any],
              let sentence = output["sentence"] as? [String: Any],
              let text = sentence["text"] as? String else { return nil }
        let words = (sentence["words"] as? [[String: Any]] ?? []).compactMap { word -> BailianWord? in
            guard let text = word["text"] as? String else { return nil }
            return BailianWord(
                beginTime: word["begin_time"] as? Int ?? 0,
                endTime: word["end_time"] as? Int ?? 0,
                text: text,
                punctuation: word["punctuation"] as? String ?? ""
            )
        }
        return BailianSentence(
            beginTime: sentence["begin_time"] as? Int ?? 0,
            endTime: sentence["end_time"] as? Int ?? 0,
            text: text,
            sentenceEnd: sentence["sentence_end"] as? Bool ?? false,
            words: words
        )
    }

    static func errorMessage(_ payload: [String: Any]) -> String {
        if let header = payload["header"] as? [String: Any] {
            return header["error_message"] as? String
                ?? header["error_code"] as? String
                ?? "Alibaba Bailian realtime ASR error"
        }
        return payload["message"] as? String ?? "Alibaba Bailian realtime ASR error"
    }
}

enum TranscriptJoiner {
    static func join(_ leftValue: String, _ rightValue: String, language: String?) -> String {
        let left = leftValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let right = rightValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !left.isEmpty else { return right }
        guard !right.isEmpty else { return left }
        let leftLast = left.last!
        let rightFirst = right.first!
        let punctuationBefore = "),.?!%:;}],，。！？、；：）》」』】"
        let punctuationAfter = "([{“‘《「『【"
        let compactLanguage = language.map { $0.hasPrefix("zh") || $0.hasPrefix("ja") } ?? false
        let omitSpace = punctuationAfter.contains(leftLast)
            || punctuationBefore.contains(rightFirst)
            || (isCJK(leftLast) && isCJK(rightFirst))
            || (compactLanguage && (isCJK(leftLast) || isCJK(rightFirst)))
        return omitSpace ? left + right : left + " " + right
    }

    static func softenBoundary(_ value: String) -> String {
        if value.hasSuffix("。") { return String(value.dropLast()) + "，" }
        if value.hasSuffix(".") && !value.hasSuffix("..") { return String(value.dropLast()) + "," }
        return value
    }

    private static func isCJK(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            (0x3400...0x9FFF).contains(scalar.value)
                || (0xF900...0xFAFF).contains(scalar.value)
                || (0x3040...0x30FF).contains(scalar.value)
        }
    }
}
