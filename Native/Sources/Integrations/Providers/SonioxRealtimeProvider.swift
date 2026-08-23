import Foundation

actor SonioxRealtimeProvider: RealtimeTranscriptionProvider {
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var stableTokens: [SonioxToken] = []
    private var stableKeys = Set<String>()
    private var liveText = ""
    private var lastFinalText = ""
    private var finalized = false
    private var configured = false
    private var connectionConfirmed = false
    private var connectionError: String?
    private var pendingAudio = RealtimePendingAudioBuffer()
    private var generation = 0

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
        lastFinalText = ""
        finalized = false
        configured = false
        connectionConfirmed = false
        connectionError = nil
        let generation = self.generation
        let socket = session.webSocketTask(with: URL(string: "wss://stt-rt.soniox.com/transcribe-websocket")!)
        self.socket = socket
        socket.resume()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(socket, generation: generation)
        }
        let config = Self.configurationPayload(for: configuration)
        try await sendJSON(config, socket: socket)
        try ensureCurrent(socket: socket, generation: generation)
        // Audit C6: confirm the connection before reporting success so a bad
        // key or rejected upgrade fails here instead of mid-session. Soniox
        // has no documented application-level ready ack, so a WebSocket pong
        // doubles as the server signal alongside any first message (which
        // also carries auth errors for an invalid api_key).
        socket.sendPing { [weak self] error in
            guard error == nil, let self else { return }
            Task { await self.confirmConnection(socket: socket, generation: generation) }
        }
        let confirmed = try await RealtimeSocketSession.waitForCondition(
            timeout: .seconds(15),
            pollInterval: .milliseconds(25),
            isSatisfied: { connectionConfirmed },
            terminalError: { connectionError },
            onTick: { try ensureCurrent(socket: socket, generation: generation) }
        )
        if let connectionError {
            await cancel()
            throw BailianRealtimeError.protocolError(connectionError)
        }
        guard confirmed else {
            await cancel()
            throw RealtimeProviderError.timedOut(provider: "Soniox")
        }
        configured = true
        try await flushPendingAudio(socket, generation: generation)
    }

    private func confirmConnection(socket: URLSessionWebSocketTask, generation: Int) {
        guard isCurrent(socket: socket, generation: generation) else { return }
        connectionConfirmed = true
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
        // Audit P2-3: leading audio truncated past the 15 s confirmation
        // budget invalidates the realtime transcript.
        if pendingAudio.leadingAudioDropped {
            await cancel()
            throw RealtimePendingAudioError.leadingAudioDropped
        }
        guard let socket else { return liveText }
        let generation = self.generation
        try await sendJSON(["type": "finalize"], socket: socket)
        try ensureCurrent(socket: socket, generation: generation)
        try await socket.send(.data(Data()))
        try ensureCurrent(socket: socket, generation: generation)
        // Audit P2-4: shared finalize budget — falls through to best-partial
        // when the `<fin>` endpoint marker never arrives (P1-13 filtering
        // in the receive loop stays authoritative for what "finalized" means).
        let finalizedInTime = try await RealtimeSocketSession.waitForCondition(
            timeout: .seconds(RealtimeSocketSession.defaultFinalizeTimeoutSeconds),
            isSatisfied: { finalized },
            terminalError: { nil },
            onTick: { try ensureCurrent(socket: socket, generation: generation) }
        )
        if !finalizedInTime { RealtimeSocketSession.logFinalizeTimeout(provider: "Soniox") }
        let result = liveText
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
        configured = false
        connectionConfirmed = false
        connectionError = nil
        pendingAudio = RealtimePendingAudioBuffer()
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation: Int) async {
        do {
            while isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                let message = try await socket.receive(timeout: .seconds(60))
                guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else { return }
                connectionConfirmed = true
                let data: Data
                switch message {
                case .data(let value): data = value
                case .string(let value): data = Data(value.utf8)
                @unknown default: continue
                }
                guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                if let error = payload["error"] {
                    if connectionError == nil { connectionError = String(describing: error) }
                    eventHandler?(.error(String(describing: error)))
                    continue
                }
                guard let rawTokens = payload["tokens"] as? [[String: Any]] else { continue }
                // Audit P1-13: route all control-token filtering through the
                // pure decoder so `<end>` (emitted by Soniox alongside `<fin>`
                // when endpoint detection is enabled) cannot leak into the
                // transcript through any single missed string compare.
                let frame = SonioxMessageDecoder.decode(rawTokens: rawTokens)
                if frame.hasEndpointToken { finalized = true }
                for token in frame.stableTokens where stableKeys.insert(token.signature).inserted {
                    stableTokens.append(token)
                }
                let unstable = frame.activeTokens.filter { !stableKeys.contains($0.signature) }
                let stable = SonioxMessageDecoder.joinedText(stableTokens)
                let active = SonioxMessageDecoder.joinedText(unstable)
                // Audit P1-13: `joined(separator: " ")` injected an ASCII
                // space between the accumulated stable text and the current
                // active text, which produced "你好 世界" between CJK glyphs.
                // Route the seam through the shared CJK-aware joiner.
                liveText = TranscriptJoiner.join(stable, active, language: nil)
                if !liveText.isEmpty { eventHandler?(.partial(stable: stable, active: active)) }
                if !stable.isEmpty, stable != lastFinalText {
                    lastFinalText = stable
                    eventHandler?(.final(stable))
                }
                if finalized { eventHandler?(.sessionFinished(stable)) }
            }
        } catch {
            if isCurrent(socket: socket, generation: generation), !Task.isCancelled,
               !RealtimeSocketSession.isBenignReceiveError(afterTerminalState: finalized) {
                if connectionError == nil { connectionError = error.localizedDescription }
                eventHandler?(.error(error.localizedDescription))
            }
        }
    }

    private func sendJSON(_ value: [String: Any], socket: URLSessionWebSocketTask) async throws {
        let data = try JSONSerialization.data(withJSONObject: value)
        try await socket.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private func appendPending(_ data: Data) {
        pendingAudio.append(data)
    }

    private func flushPendingAudio(_ socket: URLSessionWebSocketTask, generation: Int) async throws {
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
}

struct SonioxToken {
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

// Audit P1-13: pure, nonisolated Soniox raw-token decoder. Centralises the
// control-token allowlist so no other site does a bare `token == "<fin>"`
// string compare; the Soniox raw WebSocket surfaces `<end>` alongside `<fin>`
// once `enable_endpoint_detection` is on (matching their soniox-js SDK's
// `filterSpecialTokens` set), and dropping only `<fin>` here previously let
// the `<end>` marker land in the user transcript.
enum SonioxMessageDecoder {
    static let controlTokens: Set<String> = ["<end>", "<fin>"]

    struct Frame {
        let stableTokens: [SonioxToken]
        let activeTokens: [SonioxToken]
        let hasEndpointToken: Bool

        var stableText: String { SonioxMessageDecoder.joinedText(stableTokens) }
        var activeText: String { SonioxMessageDecoder.joinedText(activeTokens) }
    }

    static func decode(rawTokens: [[String: Any]]) -> Frame {
        var stable: [SonioxToken] = []
        var active: [SonioxToken] = []
        var endpoint = false
        for raw in rawTokens {
            guard let token = SonioxToken(raw) else { continue }
            if controlTokens.contains(token.text) {
                // <fin> as an is_final=true marker signals the endpoint; <end>
                // (and any non-final control tokens) are just dropped.
                if token.isFinal, token.text == "<fin>" { endpoint = true }
                continue
            }
            if token.isFinal {
                stable.append(token)
            } else {
                active.append(token)
            }
        }
        return Frame(stableTokens: stable, activeTokens: active, hasEndpointToken: endpoint)
    }

    static func joinedText(_ tokens: [SonioxToken]) -> String {
        tokens.map(\.text).joined()
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
