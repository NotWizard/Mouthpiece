import Foundation

actor AssemblyAIRealtimeProvider: RealtimeTranscriptionProvider {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var turns: [String] = []
    private var normalizedTurns: [String] = []
    private var terminated = false
    private var ready = false
    private var connectionError: String?
    private var language: String?
    private var pendingAudio: [Data] = []
    private var pendingAudioBytes = 0
    private var generation = 0
    private let maximumBufferedBytes = 3 * 16_000 * 2

    init(session: URLSession = .shared) { self.session = session }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {}

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        await cancel()
        eventHandler = onEvent
        turns.removeAll()
        normalizedTurns.removeAll()
        terminated = false
        ready = false
        connectionError = nil
        language = configuration.language
        let generation = self.generation
        var components = URLComponents(string: "wss://streaming.assemblyai.com/v3/ws")!
        var query = [
            URLQueryItem(name: "sample_rate", value: String(configuration.sampleRate)),
            URLQueryItem(name: "encoding", value: "pcm_s16le"),
            URLQueryItem(name: "format_turns", value: "true"),
        ]
        if configuration.language != nil {
            query.append(URLQueryItem(name: "speech_model", value: "universal-streaming-multilingual"))
        }
        components.queryItems = query
        // The key goes in the Authorization header (no Bearer prefix, per the
        // v3 streaming docs); a token query parameter would leak it into proxy
        // and system connection logs.
        var request = URLRequest(url: components.url!)
        request.setValue(configuration.apiKey, forHTTPHeaderField: "Authorization")
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(socket, generation: generation)
        }
        let deadline = ContinuousClock.now + .seconds(15)
        while !ready && connectionError == nil && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(25))
            try ensureCurrent(socket: socket, generation: generation)
        }
        if let connectionError {
            await cancel()
            throw BailianRealtimeError.protocolError(connectionError)
        }
        guard ready else {
            await cancel()
            throw RealtimeProviderError.timedOut(provider: "AssemblyAI")
        }
    }

    func send(pcm16: Data) async throws {
        guard ready, let socket, socket.state == .running else {
            appendPending(pcm16)
            return
        }
        try await socket.send(.data(pcm16))
    }

    func finish() async throws -> String {
        guard let socket else { return joinedTranscript() }
        let generation = self.generation
        try await socket.send(.string(#"{"type":"Terminate"}"#))
        try ensureCurrent(socket: socket, generation: generation)
        let deadline = ContinuousClock.now + .seconds(5)
        while !terminated && connectionError == nil && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(40))
            try ensureCurrent(socket: socket, generation: generation)
        }
        if let connectionError {
            await cancel()
            throw BailianRealtimeError.protocolError(connectionError)
        }
        let text = joinedTranscript()
        await cancel()
        return text
    }

    func cancel() async {
        generation += 1
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        eventHandler = nil
        ready = false
        connectionError = nil
        pendingAudio.removeAll()
        pendingAudioBytes = 0
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation: Int) async {
        do {
            while isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                let message = try await socket.receive(timeout: .seconds(60))
                guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else { return }
                let data: Data
                switch message {
                case .data(let value): data = value
                case .string(let value): data = Data(value.utf8)
                @unknown default: continue
                }
                guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let parsed = Self.parseMessage(payload) else { continue }
                switch parsed {
                case .begin:
                    ready = true
                    try await flushPendingAudio(socket, generation: generation)
                case .turn(let transcript, let endOfTurn, let isFormatted):
                    if endOfTurn {
                        Self.mergeTurn(
                            transcript,
                            isFormatted: isFormatted,
                            into: &turns,
                            normalized: &normalizedTurns
                        )
                        eventHandler?(.final(joinedTranscript()))
                    } else {
                        eventHandler?(.partial(stable: joinedTranscript(), active: transcript))
                    }
                case .termination:
                    terminated = true
                    eventHandler?(.sessionFinished(joinedTranscript()))
                case .error(let message):
                    connectionError = message
                    eventHandler?(.error(message))
                }
            }
        } catch {
            if isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                connectionError = error.localizedDescription
                eventHandler?(.error(error.localizedDescription))
            }
        }
    }

    enum ServerMessage: Equatable, Sendable {
        case begin
        case turn(transcript: String, endOfTurn: Bool, isFormatted: Bool)
        case termination
        case error(String)
    }

    // Static so fixture tests can decode real protocol samples without a socket.
    nonisolated static func parseMessage(_ payload: [String: Any]) -> ServerMessage? {
        switch payload["type"] as? String {
        case "Begin": return .begin
        case "Turn":
            guard let transcript = payload["transcript"] as? String, !transcript.isEmpty else { return nil }
            return .turn(
                transcript: transcript,
                endOfTurn: payload["end_of_turn"] as? Bool == true,
                isFormatted: payload["turn_is_formatted"] as? Bool == true
            )
        case "Termination": return .termination
        case "Error": return .error(payload["error"] as? String ?? "AssemblyAI error")
        default: return nil
        }
    }

    // The formatted re-delivery of a turn replaces the unformatted duplicate
    // instead of appending it twice.
    nonisolated static func mergeTurn(
        _ transcript: String,
        isFormatted: Bool,
        into turns: inout [String],
        normalized normalizedTurns: inout [String]
    ) {
        let normalizedTranscript = normalize(transcript)
        if normalizedTurns.last == normalizedTranscript {
            if isFormatted { turns[turns.count - 1] = transcript }
        } else {
            turns.append(transcript)
            normalizedTurns.append(normalizedTranscript)
        }
    }

    // AssemblyAI turns carry no joining hints; TranscriptJoiner drops the
    // space between CJK turns instead of gluing "你好 世界".
    private func joinedTranscript() -> String {
        turns.reduce("") { TranscriptJoiner.join($0, $1, language: language) }
    }

    private nonisolated static func normalize(_ value: String) -> String {
        value.lowercased()
            .replacingOccurrences(of: #"[^\p{L}\p{N}\s]"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func appendPending(_ data: Data) {
        guard !data.isEmpty else { return }
        pendingAudio.append(data)
        pendingAudioBytes += data.count
        while pendingAudioBytes > maximumBufferedBytes, !pendingAudio.isEmpty {
            pendingAudioBytes -= pendingAudio.removeFirst().count
        }
    }

    private func flushPendingAudio(_ socket: URLSessionWebSocketTask, generation: Int) async throws {
        let frames = pendingAudio
        pendingAudio.removeAll()
        pendingAudioBytes = 0
        for frame in frames {
            try ensureCurrent(socket: socket, generation: generation)
            try await socket.send(.data(frame))
        }
    }

    private func ensureCurrent(socket: URLSessionWebSocketTask, generation: Int) throws {
        guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else {
            throw CancellationError()
        }
    }

    private func isCurrent(socket: URLSessionWebSocketTask, generation: Int) -> Bool {
        generation == self.generation && self.socket === socket
    }
}
