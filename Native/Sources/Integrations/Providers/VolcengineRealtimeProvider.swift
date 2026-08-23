import Foundation

actor VolcengineRealtimeProvider: RealtimeTranscriptionProvider {
    static let endpoint = URL(string: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async")!
    static let model = "bigmodel"
    static let resourceID = "volc.seedasr.sauc.duration"

    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var eventHandler: (@Sendable (RealtimeTranscriptionEvent) -> Void)?
    private var pendingAudio = RealtimePendingAudioBuffer()
    private var generation = 0
    private var configured = false
    private var connectionConfirmed = false
    private var finalized = false
    private var liveText = ""
    private var stableText = ""
    private var terminalError: String?

    init(session: URLSession = .shared) { self.session = session }

    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws {}

    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws {
        await cancel()
        guard !configuration.apiKey.isEmpty else { throw VolcengineRealtimeError.missingAPIKey }

        eventHandler = onEvent
        configured = false
        connectionConfirmed = false
        finalized = false
        liveText = ""
        stableText = ""
        terminalError = nil
        let generation = self.generation

        var request = URLRequest(url: Self.endpoint)
        request.setValue(configuration.apiKey, forHTTPHeaderField: "X-Api-Key")
        request.setValue(Self.resourceID, forHTTPHeaderField: "X-Api-Resource-Id")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Api-Request-Id")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Api-Connect-Id")
        request.setValue("-1", forHTTPHeaderField: "X-Api-Sequence")

        let socket = session.webSocketTask(with: request)
        self.socket = socket
        socket.resume()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(socket, generation: generation)
        }

        do {
            let frame = try VolcengineFrameCodec.fullRequest(configuration: configuration)
            try await socket.send(.data(frame))
            try ensureCurrent(socket: socket, generation: generation)
            // Audit C6: the protocol acknowledges the full client request
            // with a first response frame; wait for it so a bad key fails
            // the connect step instead of surfacing mid-session.
            let confirmed = try await RealtimeSocketSession.waitForCondition(
                timeout: .seconds(15),
                pollInterval: .milliseconds(25),
                isSatisfied: { connectionConfirmed },
                terminalError: { terminalError },
                onTick: { try ensureCurrent(socket: socket, generation: generation) }
            )
            if let terminalError { throw VolcengineRealtimeError.protocolError(terminalError) }
            guard confirmed else { throw RealtimeProviderError.timedOut(provider: "Volcengine") }
            configured = true
            try await flushPendingAudio(socket, generation: generation)
        } catch {
            await cancel()
            throw error
        }
    }

    func send(pcm16: Data) async throws {
        guard !pcm16.isEmpty else { return }
        guard configured, let socket, socket.state == .running else {
            pendingAudio.append(pcm16)
            return
        }
        try await socket.send(.data(VolcengineFrameCodec.audio(pcm16, isLast: false)))
    }

    func finish() async throws -> String {
        // Audit P2-3: leading audio truncated past the 15 s confirmation
        // budget invalidates the realtime transcript. Route through the
        // existing throw path so DictationCoordinator's finalize catch
        // remembers the error and the empty-transcript fallback ladder
        // resurfaces the full retained PCM via batch/local.
        if pendingAudio.leadingAudioDropped {
            await cancel()
            throw RealtimePendingAudioError.leadingAudioDropped
        }
        guard let socket else { return liveText }
        let generation = self.generation
        try await socket.send(.data(VolcengineFrameCodec.audio(Data(), isLast: true)))
        try ensureCurrent(socket: socket, generation: generation)

        // Audit P2-4: shared finalize budget — falls through to best-partial
        // when the terminal frame (`is_last_package`) never arrives.
        let finalizedInTime = try await RealtimeSocketSession.waitForCondition(
            timeout: .seconds(RealtimeSocketSession.defaultFinalizeTimeoutSeconds),
            isSatisfied: { finalized },
            terminalError: { terminalError },
            onTick: { try ensureCurrent(socket: socket, generation: generation) }
        )
        if let terminalError { throw VolcengineRealtimeError.protocolError(terminalError) }
        if !finalizedInTime { RealtimeSocketSession.logFinalizeTimeout(provider: "Volcengine") }
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
        pendingAudio = RealtimePendingAudioBuffer()
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask, generation: Int) async {
        do {
            while isCurrent(socket: socket, generation: generation), !Task.isCancelled {
                let message = try await socket.receive(timeout: .seconds(60))
                guard isCurrent(socket: socket, generation: generation), !Task.isCancelled else { return }
                guard case .data(let data) = message else { continue }
                let response = try VolcengineFrameCodec.parseResponse(data)
                connectionConfirmed = true
                if let message = response.errorMessage {
                    terminalError = message
                    eventHandler?(.error(message))
                    continue
                }
                if let result = response.result {
                    let stable = result.utterances.filter(\.definite).map(\.text).joined()
                    let active = result.utterances.filter { !$0.definite }.map(\.text).joined()
                    liveText = result.text.isEmpty ? stable + active : result.text
                    if !liveText.isEmpty { eventHandler?(.partial(stable: stable, active: active)) }
                    if !stable.isEmpty, stable != stableText {
                        stableText = stable
                        eventHandler?(.final(stable))
                    }
                }
                if response.isLast {
                    finalized = true
                    eventHandler?(.sessionFinished(liveText))
                }
            }
        } catch {
            if isCurrent(socket: socket, generation: generation), !Task.isCancelled,
               !RealtimeSocketSession.isBenignReceiveError(afterTerminalState: finalized) {
                terminalError = error.localizedDescription
                eventHandler?(.error(error.localizedDescription))
            }
        }
    }

    private func flushPendingAudio(_ socket: URLSessionWebSocketTask, generation: Int) async throws {
        for frame in pendingAudio.detachAll() {
            try ensureCurrent(socket: socket, generation: generation)
            try await socket.send(.data(VolcengineFrameCodec.audio(frame, isLast: false)))
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

enum VolcengineFrameCodec {
    static func fullRequest(configuration: RealtimeTranscriptionConfiguration) throws -> Data {
        let request: [String: Any] = [
            "user": ["uid": UUID().uuidString],
            "audio": [
                "format": "pcm",
                "codec": "raw",
                "rate": configuration.sampleRate,
                "bits": 16,
                "channel": 1,
            ],
            "request": [
                "model_name": VolcengineRealtimeProvider.model,
                "enable_itn": true,
                "enable_punc": true,
                "enable_ddc": true,
                "show_utterances": true,
                "enable_nonstream": true,
                "result_type": "full",
                "end_window_size": configuration.silenceDurationMilliseconds,
            ],
        ]
        let payload = try JSONSerialization.data(withJSONObject: request)
        return frame(header: [0x11, 0x10, 0x10, 0x00], payload: payload)
    }

    static func audio(_ payload: Data, isLast: Bool) -> Data {
        frame(header: [0x11, isLast ? 0x22 : 0x20, 0x00, 0x00], payload: payload)
    }

    static func parseResponse(_ data: Data) throws -> VolcengineServerMessage {
        guard data.count >= 8 else { throw VolcengineRealtimeError.invalidFrame }
        // Parse in place: copying the whole frame into [UInt8] doubled the
        // allocation for every server message.
        return try data.withUnsafeBytes { raw -> VolcengineServerMessage in
            let bytes = raw.bindMemory(to: UInt8.self)
            let headerSize = Int(bytes[0] & 0x0F) * 4
            let messageType = bytes[1] >> 4
            let flags = bytes[1] & 0x0F
            let compression = bytes[2] & 0x0F
            guard headerSize >= 4, bytes.count >= headerSize + 4 else {
                throw VolcengineRealtimeError.invalidFrame
            }
            guard compression == 0 else { throw VolcengineRealtimeError.unsupportedCompression }

            var offset = headerSize
            if messageType == 0x0F {
                guard bytes.count >= offset + 8 else { throw VolcengineRealtimeError.invalidFrame }
                let code = readUInt32(bytes, at: offset)
                offset += 4
                let payload = try payload(bytes, offset: offset)
                let message = String(data: payload, encoding: .utf8) ?? "Unknown server error"
                return VolcengineServerMessage(errorMessage: "\(code): \(message)", isLast: true)
            }
            guard messageType == 0x09 else { throw VolcengineRealtimeError.invalidFrame }
            if flags & 0x01 != 0 {
                guard bytes.count >= offset + 8 else { throw VolcengineRealtimeError.invalidFrame }
                offset += 4
            }
            let payload = try payload(bytes, offset: offset)
            let envelope = try JSONDecoder().decode(VolcengineResponseEnvelope.self, from: payload)
            let errorMessage = envelope.code.map { $0 == 0 ? nil : envelope.message ?? "Server error \($0)" } ?? nil
            return VolcengineServerMessage(
                result: envelope.payloadMessage?.result,
                errorMessage: errorMessage,
                isLast: envelope.isLastPackage == true || flags & 0x02 != 0
            )
        }
    }

    private static func frame(header: [UInt8], payload: Data) -> Data {
        var data = Data(header)
        var size = UInt32(payload.count).bigEndian
        data.append(Data(bytes: &size, count: MemoryLayout<UInt32>.size))
        data.append(payload)
        return data
    }

    private static func payload(_ bytes: UnsafeBufferPointer<UInt8>, offset: Int) throws -> Data {
        guard bytes.count >= offset + 4 else { throw VolcengineRealtimeError.invalidFrame }
        let size = Int(readUInt32(bytes, at: offset))
        let start = offset + 4
        guard size >= 0, bytes.count >= start + size else { throw VolcengineRealtimeError.invalidFrame }
        guard let base = bytes.baseAddress else { throw VolcengineRealtimeError.invalidFrame }
        return Data(bytes: base + start, count: size)
    }

    private static func readUInt32(_ bytes: UnsafeBufferPointer<UInt8>, at offset: Int) -> UInt32 {
        (0..<4).reduce(UInt32(0)) { ($0 << 8) | UInt32(bytes[offset + $1]) }
    }
}

struct VolcengineServerMessage: Equatable {
    var result: VolcengineRecognitionResult?
    var errorMessage: String?
    var isLast = false
}

struct VolcengineResponseEnvelope: Decodable {
    var code: Int?
    var message: String?
    var isLastPackage: Bool?
    var payloadMessage: VolcengineResponsePayload?

    enum CodingKeys: String, CodingKey {
        case code, message
        case isLastPackage = "is_last_package"
        case payloadMessage = "payload_msg"
    }
}

struct VolcengineResponsePayload: Decodable {
    var result: VolcengineRecognitionResult?
}

struct VolcengineRecognitionResult: Decodable, Equatable {
    var text: String
    var utterances: [VolcengineUtterance]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        utterances = try container.decodeIfPresent([VolcengineUtterance].self, forKey: .utterances) ?? []
    }

    private enum CodingKeys: String, CodingKey { case text, utterances }
}

struct VolcengineUtterance: Decodable, Equatable {
    var text: String
    var definite: Bool
    var startTime: Int?
    var endTime: Int?
    var words: [VolcengineWord]

    enum CodingKeys: String, CodingKey {
        case text, definite, words
        case startTime = "start_time"
        case endTime = "end_time"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        definite = try container.decodeIfPresent(Bool.self, forKey: .definite) ?? false
        startTime = try container.decodeIfPresent(Int.self, forKey: .startTime)
        endTime = try container.decodeIfPresent(Int.self, forKey: .endTime)
        words = try container.decodeIfPresent([VolcengineWord].self, forKey: .words) ?? []
    }
}

struct VolcengineWord: Decodable, Equatable {
    var text: String
    var startTime: Int?
    var endTime: Int?

    enum CodingKeys: String, CodingKey {
        case text
        case startTime = "start_time"
        case endTime = "end_time"
    }
}

enum VolcengineRealtimeError: LocalizedError {
    case missingAPIKey
    case invalidFrame
    case unsupportedCompression
    case protocolError(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey: "The Volcengine API key is missing."
        case .invalidFrame: "Volcengine returned an invalid realtime response."
        case .unsupportedCompression: "Volcengine returned an unsupported compressed response."
        case .protocolError(let message): message
        }
    }
}
