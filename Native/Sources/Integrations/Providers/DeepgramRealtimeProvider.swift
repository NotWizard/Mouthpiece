import Foundation

actor DeepgramRealtimeProvider: RealtimeTranscriptionProvider {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var pendingAudio: [Data] = []
    private var pendingBytes = 0
    private var finalSegments: [String] = []
    private var finished = false
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
        guard !configuration.apiKey.isEmpty else { throw BailianRealtimeError.missingAPIKey }
        eventHandler = onEvent
        finalSegments.removeAll()
        finished = false
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
        try await flush(socket: socket, generation: generation)
    }

    func send(pcm16: Data) async throws {
        guard let socket, socket.state == .running else {
            appendPending(pcm16)
            return
        }
        try await socket.send(.data(pcm16))
    }

    func finish() async throws -> String {
        guard let socket else { return finalSegments.joined(separator: " ") }
        let generation = self.generation
        try await socket.send(.string(#"{"type":"Finalize"}"#))
        try ensureCurrent(socket: socket, generation: generation)
        try await socket.send(.string(#"{"type":"CloseStream"}"#))
        try ensureCurrent(socket: socket, generation: generation)
        let deadline = ContinuousClock.now + .seconds(5)
        while !finished && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(40))
            try ensureCurrent(socket: socket, generation: generation)
        }
        let result = finalSegments.joined(separator: " ")
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
        pendingAudio.removeAll()
        pendingBytes = 0
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation: Int) async {
        do {
            while isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                let message = try await socket.receive()
                guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else { return }
                guard let payload = json(message), let type = payload["type"] as? String else { continue }
                switch type {
                case "Results":
                    guard let channel = payload["channel"] as? [String: Any],
                          let alternatives = channel["alternatives"] as? [[String: Any]],
                          let transcript = alternatives.first?["transcript"] as? String,
                          !transcript.isEmpty else { continue }
                    if payload["is_final"] as? Bool == true || payload["from_finalize"] as? Bool == true {
                        finalSegments.append(transcript.trimmingCharacters(in: .whitespacesAndNewlines))
                        eventHandler?(.final(finalSegments.joined(separator: " ")))
                    } else {
                        eventHandler?(.partial(stable: finalSegments.joined(separator: " "), active: transcript))
                    }
                case "SpeechStarted": eventHandler?(.speechStarted)
                case "Error": eventHandler?(.error(payload["description"] as? String ?? "Deepgram error"))
                default: break
                }
            }
        } catch {
            if isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                eventHandler?(.error(error.localizedDescription))
            }
        }
        if isCurrent(socket: socket, generation: generation), !Task.isCancelled {
            finished = true
        }
    }

    private func appendPending(_ data: Data) {
        pendingAudio.append(data)
        pendingBytes += data.count
        while pendingBytes > 96_000, !pendingAudio.isEmpty { pendingBytes -= pendingAudio.removeFirst().count }
    }

    private func flush(socket: URLSessionWebSocketTask, generation: Int) async throws {
        let frames = pendingAudio
        pendingAudio.removeAll()
        pendingBytes = 0
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
