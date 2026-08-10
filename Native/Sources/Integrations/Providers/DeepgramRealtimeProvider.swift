import Foundation

actor DeepgramRealtimeProvider: RealtimeTranscriptionProvider {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var pendingAudio = RealtimePendingAudioBuffer()
    private var finalSegments: [String] = []
    private var connectionConfirmed = false
    private var closeRequested = false
    private var finished = false
    private var terminalError: String?
    private var language: String?
    private var generation = 0

    init(session: URLSession = .shared) { self.session = session }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {
        // Deepgram accepts audio immediately after the WebSocket upgrade; cold-start
        // buffering in send(pcm16:) covers the short connection window.
    }

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        await cancel()
        guard !configuration.apiKey.isEmpty else {
            throw RealtimeProviderError.missingAPIKey(provider: "Deepgram")
        }
        eventHandler = onEvent
        finalSegments.removeAll()
        connectionConfirmed = false
        closeRequested = false
        finished = false
        terminalError = nil
        language = configuration.language
        let generation = self.generation
        var components = URLComponents(string: "wss://api.deepgram.com/v1/listen")!
        var query = [
            URLQueryItem(name: "encoding", value: "linear16"),
            URLQueryItem(name: "sample_rate", value: String(configuration.sampleRate)),
            URLQueryItem(name: "channels", value: "1"),
            URLQueryItem(name: "model", value: configuration.model.isEmpty ? "nova-3" : configuration.model),
            URLQueryItem(name: "punctuate", value: "true"),
            URLQueryItem(name: "interim_results", value: "true"),
            URLQueryItem(name: "smart_format", value: "true"),
            URLQueryItem(name: "vad_events", value: "true"),
            URLQueryItem(name: "endpointing", value: "500"),
            URLQueryItem(name: "utterance_end_ms", value: "1000"),
        ]
        if let language = configuration.language, !language.isEmpty {
            query.append(URLQueryItem(name: "language", value: language))
        }
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 30
        request.setValue("Token \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        let socket = session.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(socket, generation: generation)
        }
        // Audit C6: confirm the connection before reporting success so a bad
        // key fails the connect step instead of surfacing as an opaque
        // mid-session error. Deepgram sends no application-level ack before
        // audio flows, so a WebSocket pong doubles as the server signal; a
        // rejected upgrade makes receiveLoop record the error instead.
        socket.sendPing { [weak self] error in
            guard error == nil, let self else { return }
            Task { await self.confirmConnection(socket: socket, generation: generation) }
        }
        let confirmed = try await RealtimeSocketSession.waitForCondition(
            timeout: .seconds(15),
            pollInterval: .milliseconds(25),
            isSatisfied: { connectionConfirmed },
            terminalError: { terminalError },
            onTick: { try ensureCurrent(socket: socket, generation: generation) }
        )
        if let terminalError {
            await cancel()
            throw BailianRealtimeError.protocolError(terminalError)
        }
        guard confirmed else {
            await cancel()
            throw RealtimeProviderError.timedOut(provider: "Deepgram")
        }
        try await flush(socket: socket, generation: generation)
    }

    private func confirmConnection(socket: URLSessionWebSocketTask, generation: Int) {
        guard isCurrent(socket: socket, generation: generation) else { return }
        connectionConfirmed = true
    }

    func send(pcm16: Data) async throws {
        guard let socket, socket.state == .running else {
            pendingAudio.append(pcm16)
            return
        }
        try await socket.send(.data(pcm16))
    }

    func finish() async throws -> String {
        guard let socket else { return joinedTranscript() }
        let generation = self.generation
        try await socket.send(.string(#"{"type":"Finalize"}"#))
        try ensureCurrent(socket: socket, generation: generation)
        // Audit C1: after CloseStream the server closing the socket is the
        // expected way for this session to end, not an error.
        closeRequested = true
        try await socket.send(.string(#"{"type":"CloseStream"}"#))
        try ensureCurrent(socket: socket, generation: generation)
        _ = try await RealtimeSocketSession.waitForCondition(
            timeout: .seconds(5),
            isSatisfied: { finished },
            terminalError: { terminalError },
            onTick: { try ensureCurrent(socket: socket, generation: generation) }
        )
        if let terminalError {
            await cancel()
            throw BailianRealtimeError.protocolError(terminalError)
        }
        let result = joinedTranscript()
        await cancel()
        return result
    }

    func cancel() async {
        generation += 1
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        eventHandler = nil
        connectionConfirmed = false
        closeRequested = false
        pendingAudio = RealtimePendingAudioBuffer()
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation: Int) async {
        do {
            while isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                let message = try await socket.receive(timeout: .seconds(60))
                guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else { return }
                connectionConfirmed = true
                guard let payload = json(message), let parsed = Self.parseMessage(payload) else { continue }
                switch parsed {
                case .transcript(let transcript, let isFinal):
                    if isFinal {
                        finalSegments.append(transcript.trimmingCharacters(in: .whitespacesAndNewlines))
                        eventHandler?(.final(joinedTranscript()))
                    } else {
                        eventHandler?(.partial(stable: joinedTranscript(), active: transcript))
                    }
                case .speechStarted: eventHandler?(.speechStarted)
                case .error(let message):
                    terminalError = message
                    eventHandler?(.error(message))
                }
            }
        } catch {
            if isCurrent(socket: socket, generation: generation), !Task.isCancelled,
               !RealtimeSocketSession.isBenignReceiveError(afterTerminalState: closeRequested || finished) {
                terminalError = error.localizedDescription
                eventHandler?(.error(error.localizedDescription))
            }
        }
        if isCurrent(socket: socket, generation: generation), !Task.isCancelled {
            finished = true
        }
    }

    enum ServerMessage: Equatable, Sendable {
        case transcript(text: String, isFinal: Bool)
        case speechStarted
        case error(String)
    }

    // Static so fixture tests can decode real protocol samples without a socket.
    nonisolated static func parseMessage(_ payload: [String: Any]) -> ServerMessage? {
        switch payload["type"] as? String {
        case "Results":
            guard let channel = payload["channel"] as? [String: Any],
                  let alternatives = channel["alternatives"] as? [[String: Any]],
                  let transcript = alternatives.first?["transcript"] as? String,
                  !transcript.isEmpty else { return nil }
            return .transcript(
                text: transcript,
                isFinal: payload["is_final"] as? Bool == true || payload["from_finalize"] as? Bool == true
            )
        case "SpeechStarted": return .speechStarted
        case "Error": return .error(payload["description"] as? String ?? "Deepgram error")
        default: return nil
        }
    }

    // Deepgram sends segments without joining hints; TranscriptJoiner drops
    // the space between CJK segments instead of gluing "你好 世界".
    private func joinedTranscript() -> String {
        finalSegments.reduce("") { TranscriptJoiner.join($0, $1, language: language) }
    }

    private func flush(socket: URLSessionWebSocketTask, generation: Int) async throws {
        for frame in pendingAudio.detachAll() {
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

    private func json(_ message: URLSessionWebSocketTask.Message) -> [String: Any]? {
        let data: Data
        switch message {
        case .data(let value): data = value
        case .string(let value): data = Data(value.utf8)
        @unknown default: return nil
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}
