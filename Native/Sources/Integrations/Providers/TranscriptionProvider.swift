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
        model: String = "fun-asr-realtime",
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
