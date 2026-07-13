import Foundation

enum BailianRealtimeError: LocalizedError, Equatable {
    case missingAPIKey
    case timedOut
    case connectionLost(String)
    case protocolError(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey: "Alibaba Bailian API key is required."
        case .timedOut: "Alibaba Bailian realtime connection timed out."
        case .connectionLost(let reason): "Connection lost (\(reason))."
        case .protocolError(let message): message
        }
    }
}

actor BailianRealtimeProvider: RealtimeTranscriptionProvider {
    static let endpoint = URL(
        string: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime"
    )!

    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var configuration: RealtimeTranscriptionConfiguration?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var receiveTask: Task<Void, Never>?
    private var livenessTask: Task<Void, Never>?
    private var generation = 0
    private var configured = false
    private var warmCreatedAt: Date?
    private var serverEventSeen = false
    private var reconnectAttempted = false
    private var pendingAudio: [Data] = []
    private var pendingAudioBytes = 0
    private var replayAudio: [Data] = []
    private var replayAudioBytes = 0
    private var accumulatedText = ""
    private var liveText = ""
    private var completedItemIDs = Set<String>()
    private var sessionFinished = false

    private let maximumBufferedBytes = 3 * 16_000 * 2
    private let warmTTL: TimeInterval = 5 * 60

    init(session: URLSession = .shared) {
        self.session = session
    }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {
        guard !configuration.apiKey.isEmpty else { throw BailianRealtimeError.missingAPIKey }
        if configured,
           self.configuration == configuration,
           let warmCreatedAt,
           Date().timeIntervalSince(warmCreatedAt) < warmTTL,
           socket?.state == .running {
            return
        }
        await closeSocket()
        try await createConfiguredSocket(configuration)
        warmCreatedAt = Date()
    }

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        guard !configuration.apiKey.isEmpty else { throw BailianRealtimeError.missingAPIKey }
        resetTranscript()
        eventHandler = onEvent

        let canUseWarm = configured
            && self.configuration == configuration
            && warmCreatedAt.map { Date().timeIntervalSince($0) < warmTTL } == true
            && socket?.state == .running
        if !canUseWarm {
            await closeSocket()
            try await createConfiguredSocket(configuration)
        }
        self.configuration = configuration
        warmCreatedAt = nil
        try await flushPendingAudio()
        startReceiveLoop()
    }

    func send(pcm16: Data) async throws {
        guard !pcm16.isEmpty else { return }
        guard configured, let socket, socket.state == .running else {
            appendBounded(pcm16, to: &pendingAudio, byteCount: &pendingAudioBytes)
            return
        }
        if !serverEventSeen {
            appendBounded(pcm16, to: &replayAudio, byteCount: &replayAudioBytes)
            startLivenessCheck()
        }
        try await sendAudio(pcm16, over: socket)
    }

    func finish() async throws -> String {
        guard let socket, configured, socket.state == .running else {
            return resolvedText
        }
        let payload: [String: Any] = [
            "event_id": UUID().uuidString,
            "type": "session.finish",
        ]
        try await sendJSON(payload, over: socket)
        let deadline = ContinuousClock.now + .seconds(5)
        while !sessionFinished && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(40))
        }
        let text = resolvedText
        await closeSocket()
        return text
    }

    func cancel() async {
        await closeSocket()
        resetTranscript()
    }

    private func createConfiguredSocket(_ configuration: RealtimeTranscriptionConfiguration) async throws {
        var request = URLRequest(url: Self.endpoint)
        request.timeoutInterval = 30
        request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        self.configuration = configuration
        self.configured = false
        generation += 1
        socket.resume()

        let deadline = ContinuousClock.now + .seconds(30)
        while ContinuousClock.now < deadline {
            let message = try await receive(socket: socket, timeout: .seconds(30))
            guard let payload = BailianMessageParser.payload(from: message),
                  let type = payload["type"] as? String else { continue }
            if type == "session.created" {
                try await sendJSON(sessionUpdate(configuration), over: socket)
            } else if type == "session.updated" {
                configured = true
                return
            } else if type == "error" {
                throw BailianRealtimeError.protocolError(BailianMessageParser.errorMessage(payload))
            }
        }
        throw BailianRealtimeError.timedOut
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
                let message = try await socket.receive()
                guard let payload = BailianMessageParser.payload(from: message) else { continue }
                handle(payload)
            }
        } catch {
            guard !Task.isCancelled, expectedGeneration == generation else { return }
            if !serverEventSeen && !reconnectAttempted && !replayAudio.isEmpty {
                do {
                    try await reconnectAndReplay()
                    return
                } catch {
                    eventHandler?(.error(error.localizedDescription))
                }
            } else {
                eventHandler?(.error(BailianRealtimeError.connectionLost(error.localizedDescription).localizedDescription))
            }
        }
    }

    private func handle(_ payload: [String: Any]) {
        guard let type = payload["type"] as? String else { return }
        serverEventSeen = true
        livenessTask?.cancel()
        livenessTask = nil
        replayAudio.removeAll(keepingCapacity: false)
        replayAudioBytes = 0

        switch type {
        case "conversation.item.input_audio_transcription.text":
            let stable = payload["text"] as? String ?? ""
            let active = payload["stash"] as? String ?? ""
            liveText = stable + active
            eventHandler?(.partial(
                stable: TranscriptJoiner.join(accumulatedText, stable, language: configuration?.language),
                active: active
            ))
        case "conversation.item.input_audio_transcription.completed":
            liveText = ""
            let itemID = payload["item_id"] as? String
            if itemID == nil || completedItemIDs.insert(itemID!).inserted {
                let transcript = payload["transcript"] as? String ?? ""
                accumulatedText = TranscriptJoiner.join(
                    TranscriptJoiner.softenBoundary(accumulatedText),
                    transcript,
                    language: configuration?.language
                )
            }
            eventHandler?(.final(accumulatedText))
        case "input_audio_buffer.speech_started":
            eventHandler?(.speechStarted)
        case "session.finished":
            sessionFinished = true
            eventHandler?(.sessionFinished(resolvedText))
        case "conversation.item.input_audio_transcription.failed", "error":
            eventHandler?(.error(BailianMessageParser.errorMessage(payload)))
        default:
            break
        }
    }

    private func reconnectAndReplay() async throws {
        guard !reconnectAttempted, let configuration else { return }
        reconnectAttempted = true
        let replay = replayAudio
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        configured = false
        serverEventSeen = false
        replayAudio.removeAll()
        replayAudioBytes = 0
        try await createConfiguredSocket(configuration)
        for frame in replay {
            try await send(pcm16: frame)
        }
        startReceiveLoop()
    }

    private func startLivenessCheck() {
        guard livenessTask == nil, !reconnectAttempted else { return }
        livenessTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(2_500))
            guard !Task.isCancelled, let self else { return }
            try? await self.reconnectAndReplayIfNeeded()
        }
    }

    private func reconnectAndReplayIfNeeded() async throws {
        guard !serverEventSeen, !reconnectAttempted, !replayAudio.isEmpty else { return }
        try await reconnectAndReplay()
    }

    private func flushPendingAudio() async throws {
        let frames = pendingAudio
        pendingAudio.removeAll()
        pendingAudioBytes = 0
        for frame in frames { try await send(pcm16: frame) }
    }

    private func appendBounded(_ data: Data, to frames: inout [Data], byteCount: inout Int) {
        frames.append(data)
        byteCount += data.count
        while byteCount > maximumBufferedBytes, !frames.isEmpty {
            byteCount -= frames.removeFirst().count
        }
    }

    private func sendAudio(_ data: Data, over socket: URLSessionWebSocketTask) async throws {
        let payload: [String: Any] = [
            "event_id": UUID().uuidString,
            "type": "input_audio_buffer.append",
            "audio": data.base64EncodedString(),
        ]
        try await sendJSON(payload, over: socket)
    }

    private func sendJSON(_ payload: [String: Any], over socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let text = String(data: data, encoding: .utf8) else {
            throw BailianRealtimeError.protocolError("Unable to encode Bailian request")
        }
        try await socket.send(.string(text))
    }

    private func sessionUpdate(_ configuration: RealtimeTranscriptionConfiguration) -> [String: Any] {
        var transcription: [String: Any] = [:]
        if let language = configuration.language, !language.isEmpty {
            transcription["language"] = language
        }
        return [
            "event_id": UUID().uuidString,
            "type": "session.update",
            "session": [
                "input_audio_format": "pcm",
                "sample_rate": configuration.sampleRate,
                "input_audio_transcription": transcription,
                "turn_detection": [
                    "type": "server_vad",
                    "threshold": 0.0,
                    "silence_duration_ms": configuration.silenceDurationMilliseconds,
                    "prefix_padding_ms": 300,
                ],
            ],
        ]
    }

    private func receive(
        socket: URLSessionWebSocketTask,
        timeout: Duration
    ) async throws -> URLSessionWebSocketTask.Message {
        try await withThrowingTaskGroup(of: URLSessionWebSocketTask.Message.self) { group in
            group.addTask { try await socket.receive() }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw BailianRealtimeError.timedOut
            }
            guard let first = try await group.next() else { throw BailianRealtimeError.timedOut }
            group.cancelAll()
            return first
        }
    }

    private func closeSocket() async {
        livenessTask?.cancel()
        livenessTask = nil
        receiveTask?.cancel()
        receiveTask = nil
        generation += 1
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        configured = false
        warmCreatedAt = nil
    }

    private func resetTranscript() {
        accumulatedText = ""
        liveText = ""
        completedItemIDs.removeAll()
        sessionFinished = false
        serverEventSeen = false
        reconnectAttempted = false
        pendingAudio.removeAll()
        pendingAudioBytes = 0
        replayAudio.removeAll()
        replayAudioBytes = 0
    }

    private var resolvedText: String {
        TranscriptJoiner.join(accumulatedText, liveText, language: configuration?.language)
    }
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

    static func errorMessage(_ payload: [String: Any]) -> String {
        if let error = payload["error"] as? [String: Any] {
            return error["message"] as? String
                ?? error["code"] as? String
                ?? "Alibaba Bailian realtime error"
        }
        return payload["message"] as? String ?? "Alibaba Bailian realtime error"
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
