import Foundation

actor SonioxRealtimeProvider: RealtimeTranscriptionProvider {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var stableTokens: [SonioxToken] = []
    private var stableKeys = Set<String>()
    private var liveText = ""
    private var finalized = false
    private var configured = false
    private var pendingAudio: [Data] = []
    private var pendingAudioBytes = 0
    private let maximumBufferedBytes = 3 * 16_000 * 2

    init(session: URLSession = .shared) { self.session = session }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {}

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        await cancel()
        eventHandler = onEvent
        stableTokens.removeAll()
        stableKeys.removeAll()
        liveText = ""
        finalized = false
        configured = false
        let socket = session.webSocketTask(with: URL(string: "wss://stt-rt.soniox.com/transcribe-websocket")!)
        self.socket = socket
        socket.resume()
        let config = Self.configurationPayload(for: configuration)
        try await sendJSON(config, socket: socket)
        configured = true
        try await flushPendingAudio(socket)
        receiveTask = Task { [weak self] in await self?.receiveLoop(socket) }
    }

    static func configurationPayload(
        for configuration: RealtimeTranscriptionConfiguration
    ) -> [String: Any] {
        var payload: [String: Any] = [
            "api_key": configuration.apiKey,
            "model": configuration.model,
            "audio_format": "pcm_s16le",
            "sample_rate": configuration.sampleRate,
            "num_channels": 1,
            "enable_endpoint_detection": true,
        ]
        if let language = configuration.language, !language.isEmpty {
            payload["language_hints"] = [language]
            payload["enable_language_identification"] = true
        }
        return payload
    }

    func send(pcm16: Data) async throws {
        guard configured, let socket, socket.state == .running else {
            appendPending(pcm16)
            return
        }
        try await socket.send(.data(pcm16))
    }

    func finish() async throws -> String {
        guard let socket else { return liveText }
        try await sendJSON(["type": "finalize"], socket: socket)
        try await socket.send(.data(Data()))
        let deadline = ContinuousClock.now + .seconds(5)
        while !finalized && ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(40))
        }
        let result = liveText
        await cancel()
        return result
    }

    func cancel() async {
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        configured = false
        pendingAudio.removeAll()
        pendingAudioBytes = 0
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask) async {
        do {
            while !Task.isCancelled {
                let message = try await socket.receive()
                let data: Data
                switch message {
                case .data(let value): data = value
                case .string(let value): data = Data(value.utf8)
                @unknown default: continue
                }
                guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                if let error = payload["error"] { eventHandler?(.error(String(describing: error))); continue }
                guard let rawTokens = payload["tokens"] as? [[String: Any]] else { continue }
                let tokens = rawTokens.compactMap(SonioxToken.init)
                var unstable: [SonioxToken] = []
                for token in tokens {
                    if token.text == "<fin>" {
                        if token.isFinal { finalized = true }
                        continue
                    }
                    if token.isFinal {
                        if stableKeys.insert(token.signature).inserted { stableTokens.append(token) }
                    } else if !stableKeys.contains(token.signature) {
                        unstable.append(token)
                    }
                }
                let stable = joined(stableTokens)
                let active = joined(unstable)
                liveText = [stable, active].filter { !$0.isEmpty }.joined(separator: " ")
                if !liveText.isEmpty { eventHandler?(.partial(stable: stable, active: active)) }
                if !stable.isEmpty { eventHandler?(.final(stable)) }
                if finalized { eventHandler?(.sessionFinished(stable)) }
            }
        } catch {
            if !Task.isCancelled { eventHandler?(.error(error.localizedDescription)) }
        }
    }

    private func joined(_ tokens: [SonioxToken]) -> String {
        tokens.map(\.text).joined().replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func sendJSON(_ value: [String: Any], socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private func appendPending(_ data: Data) {
        guard !data.isEmpty else { return }
        pendingAudio.append(data)
        pendingAudioBytes += data.count
        while pendingAudioBytes > maximumBufferedBytes, !pendingAudio.isEmpty {
            pendingAudioBytes -= pendingAudio.removeFirst().count
        }
    }

    private func flushPendingAudio(_ socket: URLSessionWebSocketTask) async throws {
        let frames = pendingAudio
        pendingAudio.removeAll()
        pendingAudioBytes = 0
        for frame in frames { try await socket.send(.data(frame)) }
    }
}

private struct SonioxToken {
    let text: String
    let isFinal: Bool
    let start: Int
    let end: Int

    init?(_ value: [String: Any]) {
        guard let text = value["text"] as? String, !text.isEmpty else { return nil }
        self.text = text
        isFinal = value["is_final"] as? Bool ?? false
        start = value["start_ms"] as? Int ?? -1
        end = value["end_ms"] as? Int ?? -1
    }

    var signature: String { "\(start):\(end):\(text)" }
}
