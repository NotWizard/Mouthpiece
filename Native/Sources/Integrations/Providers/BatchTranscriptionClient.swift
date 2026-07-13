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
        request.httpBody = MultipartFormData(boundary: boundary)
            .text(name: "model", value: configuration.model)
            .optionalText(name: "language", value: configuration.language)
            .optionalText(name: "prompt", value: configuration.prompt)
            .file(name: "file", filename: "recording.wav", mimeType: "audio/wav", data: wavData)
            .finalize()

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Unknown provider error"
            throw BailianRealtimeError.protocolError(message)
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

        var body: [String: Any] = [
            "file_id": fileID,
            "model": configuration.model.hasPrefix("stt-async-") ? configuration.model : "stt-async-v5",
        ]
        if let language = configuration.language { body["language_hints"] = [baseLanguage(language)] }
        if let prompt = configuration.prompt, !prompt.isEmpty { body["context"] = ["terms": prompt.split(separator: ",").map(String.init)] }
        var create = URLRequest(url: URL(string: "https://api.soniox.com/v1/transcriptions")!)
        create.httpMethod = "POST"
        create.setValue("Bearer \(configuration.apiKey)", forHTTPHeaderField: "Authorization")
        create.setValue("application/json", forHTTPHeaderField: "Content-Type")
        create.httpBody = try JSONSerialization.data(withJSONObject: body)
        let created = try await json(create)
        guard let id = created["id"] as? String else {
            throw BailianRealtimeError.protocolError("Soniox did not return a transcription ID")
        }

        do {
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
            await deleteSonioxResource(path: "transcriptions/\(id)", apiKey: configuration.apiKey)
            await deleteSonioxResource(path: "files/\(fileID)", apiKey: configuration.apiKey)
            return result
        } catch {
            await deleteSonioxResource(path: "transcriptions/\(id)", apiKey: configuration.apiKey)
            await deleteSonioxResource(path: "files/\(fileID)", apiKey: configuration.apiKey)
            throw error
        }
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
            throw BailianRealtimeError.protocolError(String(decoding: data, as: UTF8.self))
        }
        guard let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BailianRealtimeError.protocolError("Provider returned malformed JSON")
        }
        return payload
    }

    private func deleteSonioxResource(path: String, apiKey: String) async {
        var request = URLRequest(url: URL(string: "https://api.soniox.com/v1/\(path)")!)
        request.httpMethod = "DELETE"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        _ = try? await session.data(for: request)
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
