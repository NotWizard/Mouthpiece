import Foundation

struct RealtimeTranscriptionConfiguration: Equatable, Sendable {
    var apiKey: String
    var model: String
    var sampleRate: Int
    var language: String?
    var silenceDurationMilliseconds: Int
    var preferredTerms: [String]

    init(
        apiKey: String,
        model: String = BailianRealtimeProvider.defaultModel,
        sampleRate: Int = 16_000,
        language: String? = nil,
        silenceDurationMilliseconds: Int = 400,
        preferredTerms: [String] = []
    ) {
        self.apiKey = apiKey
        self.model = model
        self.sampleRate = sampleRate
        self.language = language == "auto" ? nil : language
        self.silenceDurationMilliseconds = max(200, silenceDurationMilliseconds)
        self.preferredTerms = preferredTerms
    }
}

enum RealtimeTranscriptionEvent: Equatable, Sendable {
    case partial(stable: String, active: String)
    case final(String)
    case speechStarted
    case sessionFinished(String)
    case error(String)
}

protocol RealtimeTranscriptionProvider: Sendable {
    func warmup(configuration: RealtimeTranscriptionConfiguration) async throws
    func connect(
        configuration: RealtimeTranscriptionConfiguration,
        onEvent: @escaping @Sendable (RealtimeTranscriptionEvent) -> Void
    ) async throws
    func send(pcm16: Data) async throws
    func finish() async throws -> String
    func cancel() async
}

enum RealtimeSocketError: LocalizedError {
    case receiveTimedOut

    var errorDescription: String? {
        "The realtime transcription server stopped responding."
    }
}

// Non-Bailian realtime providers used to borrow BailianRealtimeError, which
// showed "Alibaba Bailian" in errors coming from Deepgram or AssemblyAI.
enum RealtimeProviderError: LocalizedError, Equatable {
    case missingAPIKey(provider: String)
    case timedOut(provider: String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey(let provider): "\(provider) API key is required."
        case .timedOut(let provider): "\(provider) realtime connection timed out."
        }
    }
}

extension URLSessionWebSocketTask {
    // A half-dead connection leaves receive() waiting forever with no error,
    // and receive() may ignore Task cancellation, so race it against a
    // deadline and abandon the loser; the abandoned receive settles once the
    // caller closes the socket.
    func receive(timeout: Duration) async throws -> Message {
        final class Gate: @unchecked Sendable {
            private var claimed = false
            private let lock = NSLock()

            func claim() -> Bool {
                lock.lock()
                defer { lock.unlock() }
                if claimed { return false }
                claimed = true
                return true
            }
        }
        let gate = Gate()
        return try await withCheckedThrowingContinuation { continuation in
            let timer = Task {
                try? await Task.sleep(for: timeout)
                if gate.claim() {
                    continuation.resume(throwing: RealtimeSocketError.receiveTimedOut)
                }
            }
            Task {
                do {
                    let message = try await self.receive()
                    if gate.claim() {
                        timer.cancel()
                        continuation.resume(returning: message)
                    }
                } catch {
                    if gate.claim() {
                        timer.cancel()
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }
}

struct BatchTranscriptionConfiguration: Sendable {
    var provider: String
    var endpoint: URL
    var apiKey: String
    var model: String
    var language: String?
    var prompt: String?
    var authorizationHeader = "Authorization"
    var authorizationPrefix = "Bearer "
}
