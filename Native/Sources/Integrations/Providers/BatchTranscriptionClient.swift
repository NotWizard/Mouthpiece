import Foundation

struct BatchTranscriptionClient: Sendable {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func transcribe(wavData: Data, configuration: BatchTranscriptionConfiguration) async throws -> String {
        switch configuration.provider {
        case "deepgram":
            return try await transcribeDeepgram(wavData: wavData, configuration: configuration)
        case "assemblyai":
            return try await transcribeAssemblyAI(wavData: wavData, configuration: configuration)
        case "soniox":
            return try await transcribeSoniox(wavData: wavData, configuration: configuration)
        case "bailian":
            return try await transcribeBailian(wavData: wavData, configuration: configuration)
        default:
            return try await transcribeOpenAICompatible(wavData: wavData, configuration: configuration)
        }
    }

    private func transcribeOpenAICompatible(
        wavData: Data,
        configuration: BatchTranscriptionConfiguration
    ) async throws -> String {
        let boundary = "Mouthpiece-\(UUID().uuidString)"
        var request = URLRequest(url: configuration.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(
            configuration.authorizationPrefix + configuration.apiKey,
            forHTTPHeaderField: configuration.authorizationHeader
        )
        if configuration.provider == "openrouter" {
            // OpenRouter's optional attribution header; identifies the app in
            // their rankings.
            request.setValue("Mouthpiece", forHTTPHeaderField: "X-Title")
        }
        // gpt-transcribe replaced the singular language hint with languages[]
        // (the two fields must never be sent together); other
        // OpenAI-compatible models keep the singular field.
        let languageField = configuration.model == "gpt-transcribe" ? "languages[]" : "language"
        var form = MultipartFormData(boundary: boundary)
            .text(name: "model", value: configuration.model)
            .optionalText(name: languageField, value: configuration.language)
            .optionalText(name: "prompt", value: configuration.prompt)
        // Mistral accepts up to 100 context_bias hints as repeated multipart
        // fields — the same wire format the OpenAI SDK's extra_body produces.
        if configuration.provider == "mistral" {
            for term in Self.mistralContextBiasTerms(configuration.preferredTerms) {
                form = form.text(name: "context_bias", value: term)
            }
        }
        request.httpBody = form
            .file(name: "file", filename: "recording.wav", mimeType: "audio/wav", data: wavData)
            .finalize()

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw BailianRealtimeError.protocolError(
                ProviderErrorSanitizer.message(from: data, statusCode: status)
            )
        }
        let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let text = payload?["text"] as? String else {
            throw BailianRealtimeError.protocolError("Transcription response did not contain text")
        }
        return text
    }

    private func transcribeDeepgram(
        wavData: Data,
        configuration: BatchTranscriptionConfiguration
    ) async throws -> String {
        var components = URLComponents(string: "https://api.deepgram.com/v1/listen")!
        var query = [
            URLQueryItem(name: "model", value: configuration.model.isEmpty ? "nova-3" : configuration.model),
            URLQueryItem(name: "smart_format", value: "true"),
        ]
        if let language = configuration.language { query.append(URLQueryItem(name: "language", value: language)) }
        components.queryItems = query
        var request = URLRequest(url: components.url!)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("Token \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        request.httpBody = wavData
        let payload = try await json(request)
        guard let results = payload["results"] as? [String: Any],
              let channels = results["channels"] as? [[String: Any]],
              let alternatives = channels.first?["alternatives"] as? [[String: Any]],
              let text = alternatives.first?["transcript"] as? String else {
            throw BailianRealtimeError.protocolError("Deepgram response did not contain a transcript")
        }
        return text
    }

    private func transcribeAssemblyAI(
        wavData: Data,
        configuration: BatchTranscriptionConfiguration
    ) async throws -> String {
        var upload = URLRequest(url: URL(string: "https://api.assemblyai.com/v2/upload")!)
        upload.httpMethod = "POST"
        upload.timeoutInterval = 120
        upload.setValue(configuration.apiKey, forHTTPHeaderField: "Authorization")
        upload.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        upload.httpBody = wavData
        let uploaded = try await json(upload)
        guard let audioURL = uploaded["upload_url"] as? String else {
            throw BailianRealtimeError.protocolError("AssemblyAI upload did not return an audio URL")
        }

        var body: [String: Any] = ["audio_url": audioURL]
        if let language = configuration.language { body["language_code"] = baseLanguage(language) }
        var create = URLRequest(url: URL(string: "https://api.assemblyai.com/v2/transcript")!)
        create.httpMethod = "POST"
        create.timeoutInterval = 30
        create.setValue(configuration.apiKey, forHTTPHeaderField: "Authorization")
        create.setValue("application/json", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONSerialization.data(withJSONObject: body)
        let created = try await json(create)
        guard let id = created["id"] as? String else {
            throw BailianRealtimeError.protocolError("AssemblyAI did not return a transcript ID")
        }

        return try await poll(timeout: .seconds(180)) {
            var request = URLRequest(url: URL(string: "https://api.assemblyai.com/v2/transcript/\(id)")!)
            request.setValue(configuration.apiKey, forHTTPHeaderField: "Authorization")
            let payload = try await json(request)
            switch payload["status"] as? String {
            case "completed": return .completed(payload["text"] as? String ?? "")
            case "error": return .failed(payload["error"] as? String ?? "AssemblyAI transcription failed")
            default: return .pending
            }
        }
    }

    private func transcribeSoniox(
        wavData: Data,
        configuration: BatchTranscriptionConfiguration
    ) async throws -> String {
        let boundary = "Mouthpiece-\(UUID().uuidString)"
        var upload = URLRequest(url: URL(string: "https://api.soniox.com/v1/files")!)
        upload.httpMethod = "POST"
        upload.timeoutInterval = 120
        upload.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        upload.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        upload.httpBody = MultipartFormData(boundary: boundary)
            .file(name: "file", filename: "recording.wav", mimeType: "audio/wav", data: wavData)
            .finalize()
        let uploaded = try await json(upload)
        guard let fileID = uploaded["id"] as? String else {
            throw BailianRealtimeError.protocolError("Soniox upload did not return a file ID")
        }

        var transcriptionID: String?
        do {
            var body: [String: Any] = [
                "file_id": fileID,
                "model": configuration.model.hasPrefix("stt-async-") ? configuration.model : "stt-async-v5",
            ]
            if let language = configuration.language { body["language_hints"] = [baseLanguage(language)] }
            let contextTerms = SonioxRealtimeProvider.normalizedContextTerms(configuration.preferredTerms)
            if !contextTerms.isEmpty { body["context"] = ["terms": contextTerms] }
            var create = URLRequest(url: URL(string: "https://api.soniox.com/v1/transcriptions")!)
            create.httpMethod = "POST"
            create.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
            create.setValue("application/json", forHTTPHeaderField: "Content-Type")
            create.httpBody = try JSONSerialization.data(withJSONObject: body)
            let created = try await json(create)
            guard let id = created["id"] as? String else {
                throw BailianRealtimeError.protocolError("Soniox did not return a transcription ID")
            }
            transcriptionID = id

            let result = try await poll(timeout: .seconds(180)) {
                var request = URLRequest(url: URL(string: "https://api.soniox.com/v1/transcriptions/\(id)")!)
                request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
                let payload = try await json(request)
                switch payload["status"] as? String {
                case "completed":
                    var transcript = URLRequest(url: URL(string: "https://api.soniox.com/v1/transcriptions/\(id)/transcript")!)
                    transcript.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
                    let final = try await json(transcript)
                    let tokens = final["tokens"] as? [[String: Any]] ?? []
                    let text = tokens.compactMap { $0["text"] as? String }.joined()
                    return .completed(text)
                case "error", "failed":
                    return .failed(payload["error_message"] as? String ?? "Soniox transcription failed")
                default: return .pending
                }
            }
            await deleteSonioxResources(
                fileID: fileID,
                transcriptionID: transcriptionID,
                apiKey: configuration.apiKey
            )
            return result
        } catch {
            await deleteSonioxResources(
                fileID: fileID,
                transcriptionID: transcriptionID,
                apiKey: configuration.apiKey
            )
            throw error
        }
    }

    // The one-shot HTTP fallback for Bailian's realtime WebSocket channel:
    // qwen-audio-3.1-asr-flash via the multimodal-generation endpoint. Kept
    // alongside the WS model family it backstops; the model is fixed because
    // the HTTP SKU is independent of whichever realtime model is configured.
    static let bailianFallbackModel = "qwen-audio-3.1-asr-flash"
    static let bailianEndpoint = URL(
        string: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    )!
    // Base64 inflates the payload by 4/3 and the endpoint caps Base64 input
    // at 10 MB. 7.4 MB of WAV is ~230 s of 16 kHz mono — under both the
    // 10 MB budget (≈ 9.87 MB encoded) and the endpoint's 5-minute duration
    // cap, so the single byte guard covers both limits. Oversize audio
    // throws here and falls through to the local fallback ladder instead of
    // paying for a guaranteed server rejection.
    static let bailianMaximumWAVBytes = 7_400_000

    static func bailianRequestPayload(wavBase64: String, preferredTerms: [String]) -> [String: Any] {
        var parameters: [String: Any] = [
            "format": "wav",
            "sample_rate": "16000",
        ]
        // Same inline hot-word object (and normalization) as the realtime
        // channel, so fallback transcriptions keep the user's vocabulary.
        let vocabulary = BailianVocabularyService.inlineVocabulary(preferredTerms)
        if !vocabulary.isEmpty {
            parameters["vocabulary"] = vocabulary
        }
        let audioContent: [[String: Any]] = [
            [
                "type": "input_audio",
                "input_audio": ["data": "data:audio/wav;base64," + wavBase64],
            ],
        ]
        let messages: [[String: Any]] = [
            ["role": "user", "content": audioContent],
        ]
        return [
            "model": bailianFallbackModel,
            "input": ["messages": messages] as [String: Any],
            "parameters": parameters,
        ]
    }

    static func bailianTranscript(from data: Data) -> String? {
        guard let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let output = payload["output"] as? [String: Any],
              let text = output["text"] as? String else { return nil }
        return text
    }

    private func transcribeBailian(
        wavData: Data,
        configuration: BatchTranscriptionConfiguration
    ) async throws -> String {
        guard wavData.count <= Self.bailianMaximumWAVBytes else {
            throw BailianRealtimeError.protocolError(
                "Bailian batch transcription supports recordings up to about four minutes."
            )
        }
        var request = URLRequest(url: configuration.endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // The recorded-speech HTTP API only streams intermediate results for
        // audio of one minute or longer; short dictations get a single final
        // response, which is all the fallback needs.
        request.setValue("disable", forHTTPHeaderField: "X-DashScope-SSE")
        request.httpBody = try JSONSerialization.data(withJSONObject: Self.bailianRequestPayload(
            wavBase64: wavData.base64EncodedString(),
            preferredTerms: configuration.preferredTerms
        ))
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw BailianRealtimeError.protocolError(
                ProviderErrorSanitizer.message(from: data, statusCode: status)
            )
        }
        guard let text = Self.bailianTranscript(from: data), !text.isEmpty else {
            throw BailianRealtimeError.protocolError("Bailian batch transcription returned no text")
        }
        return text
    }

    // Mistral's transcription endpoint caps context_bias at 100 terms.
    static func mistralContextBiasTerms(_ terms: [String]) -> [String] {
        var seen = Set<String>()
        return terms.compactMap { term in
            let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, seen.insert(trimmed.lowercased()).inserted else { return nil }
            return trimmed
        }
        .prefix(100)
        .map { $0 }
    }

    private enum PollResult {
        case pending
        case completed(String)
        case failed(String)
    }

    private func poll(
        timeout: Duration,
        operation: () async throws -> PollResult
    ) async throws -> String {
        let deadline = ContinuousClock.now.advanced(by: timeout)
        while ContinuousClock.now < deadline {
            switch try await operation() {
            case .pending: try await Task.sleep(for: .seconds(1))
            case .completed(let text): return text
            case .failed(let message): throw BailianRealtimeError.protocolError(message)
            }
        }
        throw BailianRealtimeError.protocolError("Transcription timed out")
    }

    private func json(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw BailianRealtimeError.protocolError(
                ProviderErrorSanitizer.message(from: data, statusCode: status)
            )
        }
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BailianRealtimeError.protocolError("Provider returned malformed JSON")
        }
        return payload
    }

    private static func deleteSonioxResource(
        path: String,
        apiKey: String,
        session: URLSession
    ) async {
        var request = URLRequest(url: URL(string: "https://api.soniox.com/v1/\(path)")!)
        request.httpMethod = "DELETE"
        request.timeoutInterval = 15
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
    }

    private func deleteSonioxResources(fileID: String, transcriptionID: String?, apiKey: String) async {
        let session = session
        let cleanup = Task.detached(priority: .utility) {
            if let transcriptionID {
                await Self.deleteSonioxResource(
                    path: "transcriptions/\(transcriptionID)",
                    apiKey: apiKey,
                    session: session
                )
            }
            await Self.deleteSonioxResource(
                path: "files/\(fileID)",
                apiKey: apiKey,
                session: session
            )
        }
        guard !Task.isCancelled else { return }
        await cleanup.value
    }

    private func baseLanguage(_ language: String) -> String {
        language.split(separator: "-").first.map(String.init) ?? language
    }
}

private struct MultipartFormData {
    let boundary: String
    private var data = Data()

    init(boundary: String) {
        self.boundary = boundary
    }

    func text(name: String, value: String) -> Self {
        var copy = self
        copy.data.append("--\(boundary)\r\n")
        copy.data.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        copy.data.append("\(value)\r\n")
        return copy
    }

    func optionalText(name: String, value: String?) -> Self {
        guard let value, !value.isEmpty else { return self }
        return text(name: name, value: value)
    }

    func file(name: String, filename: String, mimeType: String, data fileData: Data) -> Self {
        var copy = self
        copy.data.append("--\(boundary)\r\n")
        copy.data.append(
            "Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n"
        )
        copy.data.append("Content-Type: \(mimeType)\r\n\r\n")
        copy.data.append(fileData)
        copy.data.append("\r\n")
        return copy
    }

    func finalize() -> Data {
        var result = data
        result.append("--\(boundary)--\r\n")
        return result
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(contentsOf: string.utf8)
    }
}
