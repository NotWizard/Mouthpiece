import Darwin
import Foundation

enum LocalModelRuntimeError: LocalizedError, Equatable {
    case binaryMissing(String)
    case modelMissing(String)
    case unsupported(String)
    case noAvailablePort(ClosedRange<Int>)
    case launchFailed(String)
    case startupTimedOut(String)
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .binaryMissing(let name): "Required local runtime is missing: \(name)."
        case .modelMissing(let name): "Local model is not downloaded: \(name)."
        case .unsupported(let reason): reason
        case .noAvailablePort(let range): "No local server port is available in \(range)."
        case .launchFailed(let message): "Local model server failed to launch: \(message)"
        case .startupTimedOut(let name): "\(name) did not become ready in time."
        case .invalidResponse(let message): "Local model returned an invalid response: \(message)"
        }
    }
}

struct LocalModelStatus: Equatable, Sendable {
    var runtimeAvailable: Bool
    var modelAvailable: Bool
    var running: Bool
}

actor LocalModelRuntime {
    private struct RunningServer {
        let process: Process
        let port: Int
        let model: String
        let apiKey: String?
    }

    private let session: URLSession
    private let fileManager: FileManager
    private var whisper: RunningServer?
    private var parakeet: RunningServer?
    private var qwen: RunningServer?

    init(session: URLSession = .shared, fileManager: FileManager = .default) {
        self.session = session
        self.fileManager = fileManager
    }

    func status(provider: LocalTranscriptionProvider, model: String) -> LocalModelStatus {
        let binary = binaryURL(for: provider) != nil
        let modelURL = modelURL(for: provider, model: model)
        let downloaded = modelIsValid(provider: provider, url: modelURL)
        let running: Bool
        switch provider {
        case .whisper: running = whisper?.process.isRunning == true && whisper?.model == model
        case .parakeet: running = parakeet?.process.isRunning == true && parakeet?.model == model
        case .qwen: running = qwen?.process.isRunning == true && qwen?.model == model
        }
        return LocalModelStatus(runtimeAvailable: binary, modelAvailable: downloaded, running: running)
    }

    func transcribe(
        pcm16: Data,
        settings: AppSettings,
        prompt: String?
    ) async throws -> String {
        switch settings.localTranscriptionProvider {
        case .whisper:
            return try await transcribeWhisper(
                wav: WAVEncoder.pcm16Mono(pcm16),
                model: settings.whisperModel,
                language: settings.preferredLanguage,
                prompt: prompt
            )
        case .parakeet:
            return try await transcribeParakeet(
                pcm16: pcm16,
                model: settings.parakeetModel.isEmpty ? "parakeet-tdt-0.6b-v3" : settings.parakeetModel
            )
        case .qwen:
            return try await transcribeQwen(
                wav: WAVEncoder.pcm16Mono(pcm16),
                model: settings.qwenASRModel,
                language: settings.preferredLanguage,
                prompt: prompt
            )
        }
    }

    func stopAll() {
        [whisper, parakeet, qwen].compactMap(\.self).forEach { stop($0.process) }
        whisper = nil
        parakeet = nil
        qwen = nil
    }

    private func transcribeWhisper(
        wav: Data,
        model: String,
        language: String,
        prompt: String?
    ) async throws -> String {
        let server = try await ensureWhisper(model: model, language: language)
        let endpoint = URL(string: "http://127.0.0.1:\(server.port)/inference")!
        return try await multipartTranscribe(
            endpoint: endpoint,
            wav: wav,
            fields: [
                "language": language,
                "prompt": prompt,
                "response_format": "json",
            ]
        )
    }

    private func transcribeQwen(
        wav: Data,
        model: String,
        language: String,
        prompt: String?
    ) async throws -> String {
        let server = try await ensureQwen(model: model)
        let endpoint = URL(string: "http://127.0.0.1:\(server.port)/v1/audio/transcriptions")!
        return try await multipartTranscribe(
            endpoint: endpoint,
            wav: wav,
            fields: [
                "model": qwenModelID(model),
                "language": language == "auto" ? nil : language,
                "prompt": prompt,
                "response_format": "json",
            ],
            bearerToken: server.apiKey
        )
    }

    private func transcribeParakeet(pcm16: Data, model: String) async throws -> String {
        let server = try await ensureParakeet(model: model)
        let segments = pcm16.chunked(maximumBytes: 15 * 16_000 * 2)
        var results: [String] = []
        for segment in segments where Self.rms(ofPCM16: segment) >= 0.001 {
            let task = session.webSocketTask(with: URL(string: "ws://127.0.0.1:\(server.port)")!)
            task.resume()
            var message = Data()
            message.appendLittleEndian(Int32(16_000))
            let floatSamples = Self.float32Samples(fromPCM16: segment)
            message.appendLittleEndian(Int32(floatSamples.count))
            message.append(floatSamples)
            try await task.send(.data(message))
            let response = try await task.receive()
            let text: String
            switch response {
            case .string(let value): text = value
            case .data(let value): text = String(decoding: value, as: UTF8.self)
            @unknown default: text = ""
            }
            try await task.send(.string("Done"))
            task.cancel(with: .normalClosure, reason: nil)
            results.append(Self.transcript(from: Data(text.utf8)))
        }
        return results.filter { !$0.isEmpty }.joined(separator: " ")
    }

    private func ensureWhisper(model: String, language: String) async throws -> RunningServer {
        if let whisper, whisper.process.isRunning, whisper.model == model { return whisper }
        if let whisper { stop(whisper.process) }
        guard let binary = binaryURL(for: .whisper) else {
            throw LocalModelRuntimeError.binaryMissing(binaryName(for: .whisper))
        }
        let modelURL = modelURL(for: .whisper, model: model)
        guard modelIsValid(provider: .whisper, url: modelURL) else {
            throw LocalModelRuntimeError.modelMissing(model)
        }
        let port = try availablePort(in: 8178...8199)
        let server = try launch(
            executable: binary,
            arguments: [
                "--model", modelURL.path,
                "--host", "127.0.0.1",
                "--port", String(port),
                "--language", language.isEmpty ? "auto" : language,
            ],
            port: port,
            model: model
        )
        try await waitForHTTP(server: server, paths: ["/"], timeout: .seconds(60))
        whisper = server
        return server
    }

    private func ensureParakeet(model: String) async throws -> RunningServer {
        if let parakeet, parakeet.process.isRunning, parakeet.model == model { return parakeet }
        if let parakeet { stop(parakeet.process) }
        guard let binary = binaryURL(for: .parakeet) else {
            throw LocalModelRuntimeError.binaryMissing(binaryName(for: .parakeet))
        }
        let modelURL = modelURL(for: .parakeet, model: model)
        guard modelIsValid(provider: .parakeet, url: modelURL) else {
            throw LocalModelRuntimeError.modelMissing(model)
        }
        let port = try availablePort(in: 6006...6029)
        let server = try launch(
            executable: binary,
            arguments: [
                "--tokens=\(modelURL.appendingPathComponent("tokens.txt").path)",
                "--encoder=\(modelURL.appendingPathComponent("encoder.int8.onnx").path)",
                "--decoder=\(modelURL.appendingPathComponent("decoder.int8.onnx").path)",
                "--joiner=\(modelURL.appendingPathComponent("joiner.int8.onnx").path)",
                "--port=\(port)",
                "--num-threads=\(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount * 3 / 4)))",
            ],
            port: port,
            model: model
        )
        try await waitForPort(server: server, timeout: .seconds(60))
        parakeet = server
        return server
    }

    private func ensureQwen(model: String) async throws -> RunningServer {
#if arch(arm64)
        if let qwen, qwen.process.isRunning, qwen.model == model { return qwen }
        if let qwen { stop(qwen.process) }
        guard let binary = binaryURL(for: .qwen) else {
            throw LocalModelRuntimeError.binaryMissing(binaryName(for: .qwen))
        }
        let modelURL = modelURL(for: .qwen, model: model)
        guard modelIsValid(provider: .qwen, url: modelURL) else {
            throw LocalModelRuntimeError.modelMissing(model)
        }
        let port = try availablePort(in: 6030...6059)
        let apiKey = UUID().uuidString.replacingOccurrences(of: "-", with: "")
        let qwenModelsDirectory = modelURL.deletingLastPathComponent().deletingLastPathComponent()
        var environment = ProcessInfo.processInfo.environment
        environment["HF_HOME"] = qwenModelsDirectory.path
        environment["HF_HUB_CACHE"] = qwenModelsDirectory.appendingPathComponent("hub").path
        environment["HUGGINGFACE_HUB_CACHE"] = environment["HF_HUB_CACHE"]
        environment["TRANSFORMERS_CACHE"] = qwenModelsDirectory.appendingPathComponent("transformers").path
        environment["TOKENIZERS_PARALLELISM"] = "false"
        let server = try launch(
            executable: binary,
            arguments: [
                "serve", "--host", "127.0.0.1", "--port", String(port),
                "--api-key", apiKey, "--model", qwenModelID(model),
            ],
            port: port,
            model: model,
            apiKey: apiKey,
            environment: environment
        )
        try await waitForHTTP(
            server: server,
            paths: ["/health", "/v1/models"],
            timeout: .seconds(120),
            bearerToken: apiKey
        )
        qwen = server
        return server
#else
        throw LocalModelRuntimeError.unsupported("Qwen ASR MLX requires an Apple Silicon Mac.")
#endif
    }

    private func launch(
        executable: URL,
        arguments: [String],
        port: Int,
        model: String,
        apiKey: String? = nil,
        environment: [String: String]? = nil
    ) throws -> RunningServer {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = FileManager.default.temporaryDirectory
        process.environment = environment
        let null = FileHandle(forWritingAtPath: "/dev/null")
        process.standardOutput = null
        process.standardError = null
        do {
            try process.run()
        } catch {
            throw LocalModelRuntimeError.launchFailed(error.localizedDescription)
        }
        return RunningServer(process: process, port: port, model: model, apiKey: apiKey)
    }

    private func waitForHTTP(
        server: RunningServer,
        paths: [String],
        timeout: Duration,
        bearerToken: String? = nil
    ) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            guard server.process.isRunning else {
                throw LocalModelRuntimeError.launchFailed("process exited during startup")
            }
            for path in paths {
                var request = URLRequest(url: URL(string: "http://127.0.0.1:\(server.port)\(path)")!)
                request.timeoutInterval = 2
                if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }
                if let (_, response) = try? await session.data(for: request),
                   let http = response as? HTTPURLResponse,
                   (200..<500).contains(http.statusCode) {
                    return
                }
            }
            try await Task.sleep(for: .milliseconds(150))
        }
        stop(server.process)
        throw LocalModelRuntimeError.startupTimedOut(server.model)
    }

    private func waitForPort(server: RunningServer, timeout: Duration) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            guard server.process.isRunning else {
                throw LocalModelRuntimeError.launchFailed("process exited during startup")
            }
            if !Self.isPortAvailable(server.port) { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        stop(server.process)
        throw LocalModelRuntimeError.startupTimedOut(server.model)
    }

    private func multipartTranscribe(
        endpoint: URL,
        wav: Data,
        fields: [String: String?],
        bearerToken: String? = nil
    ) async throws -> String {
        let boundary = "Mouthpiece-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"recording.wav\"\r\n")
        body.append("Content-Type: audio/wav\r\n\r\n")
        body.append(wav)
        body.append("\r\n")
        for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
            guard let value, !value.isEmpty else { continue }
            body.append("--\(boundary)\r\n")
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
            body.append("\(value)\r\n")
        }
        body.append("--\(boundary)--\r\n")

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let bearerToken { request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization") }
        request.httpBody = body
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw LocalModelRuntimeError.invalidResponse(String(decoding: data, as: UTF8.self))
        }
        return Self.transcript(from: data)
    }

    private func modelURL(for provider: LocalTranscriptionProvider, model: String) -> URL {
        let candidates = modelURLs(for: provider, model: model)
        return candidates.first { modelIsValid(provider: provider, url: $0) } ?? candidates[0]
    }

    private func modelURLs(for provider: LocalTranscriptionProvider, model: String) -> [URL] {
        switch provider {
        case .whisper:
            let filename = model.hasSuffix(".bin") ? model : "ggml-\(model == "large" ? "large-v3" : model).bin"
            return [AppPaths.whisperModelsDirectory, AppPaths.legacyWhisperModelsDirectory]
                .map { $0.appendingPathComponent(filename) }
        case .parakeet:
            return [AppPaths.parakeetModelsDirectory, AppPaths.legacyParakeetModelsDirectory]
                .map { $0.appendingPathComponent(model) }
        case .qwen:
            return [AppPaths.qwenASRModelsDirectory, AppPaths.legacyQwenASRModelsDirectory]
                .map {
                    $0.appendingPathComponent("hub", isDirectory: true)
                        .appendingPathComponent("models--\(qwenModelID(model).replacingOccurrences(of: "/", with: "--"))", isDirectory: true)
                }
        }
    }

    private func modelIsValid(provider: LocalTranscriptionProvider, url: URL) -> Bool {
        switch provider {
        case .whisper:
            return fileManager.fileExists(atPath: url.path)
        case .parakeet:
            return ["tokens.txt", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"]
                .allSatisfy { fileManager.fileExists(atPath: url.appendingPathComponent($0).path) }
        case .qwen:
            let root = url.deletingLastPathComponent().deletingLastPathComponent()
            let marker = root
                .appendingPathComponent(".mouthpiece", isDirectory: true)
                .appendingPathComponent(url.lastPathComponent.replacingOccurrences(of: "models--Qwen--", with: "qwen3-asr-").lowercased() + ".json")
            return fileManager.fileExists(atPath: url.path) || fileManager.fileExists(atPath: marker.path)
        }
    }

    private func binaryURL(for provider: LocalTranscriptionProvider) -> URL? {
        let name = binaryName(for: provider)
        var candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("bin/\(name)"),
            Bundle.main.resourceURL?.appendingPathComponent("Binaries/\(runtimeDirectory(for: provider))/\(name)"),
            Bundle.main.resourceURL?.appendingPathComponent(name),
            AppPaths.applicationSupportDirectory.appendingPathComponent("bin/\(name)"),
            URL(fileURLWithPath: FileManager.default.currentDirectoryPath).appendingPathComponent("resources/bin/\(name)"),
        ].compactMap { $0 }
        if provider == .qwen {
            candidates.insert(
                AppPaths.legacyQwenASRRuntimeDirectory.appendingPathComponent("bin/\(name)"),
                at: 0
            )
            candidates.insert(
                AppPaths.qwenASRRuntimeDirectory.appendingPathComponent("bin/\(name)"),
                at: 0
            )
        }
        if provider == .whisper {
            candidates.append(contentsOf: candidates.map { $0.deletingLastPathComponent().appendingPathComponent("whisper-server") })
        }
        return candidates.first { fileManager.isExecutableFile(atPath: $0.path) }
    }

    private func runtimeDirectory(for provider: LocalTranscriptionProvider) -> String {
        switch provider {
        case .whisper: "whisper"
        case .parakeet: "parakeet"
        case .qwen: "qwen"
        }
    }

    private func binaryName(for provider: LocalTranscriptionProvider) -> String {
#if arch(arm64)
        let architecture = "arm64"
#else
        let architecture = "x64"
#endif
        return switch provider {
        case .whisper: "whisper-server-darwin-\(architecture)"
        case .parakeet: "sherpa-onnx-ws-darwin-\(architecture)"
        case .qwen: "mlx-qwen3-asr"
        }
    }

    private func qwenModelID(_ model: String) -> String {
        model.contains("1.7b") ? "Qwen/Qwen3-ASR-1.7B" : "Qwen/Qwen3-ASR-0.6B"
    }

    private func availablePort(in range: ClosedRange<Int>) throws -> Int {
        guard let port = range.first(where: Self.isPortAvailable) else {
            throw LocalModelRuntimeError.noAvailablePort(range)
        }
        return port
    }

    private nonisolated static func isPortAvailable(_ port: Int) -> Bool {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { Darwin.close(descriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }

    private nonisolated static func float32Samples(fromPCM16 pcm: Data) -> Data {
        var output = Data(capacity: pcm.count * 2)
        pcm.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for sample in samples {
                output.appendLittleEndian(Float32(Int16(littleEndian: sample)) / 32768)
            }
        }
        return output
    }

    private nonisolated static func rms(ofPCM16 pcm: Data) -> Double {
        var sum = 0.0
        var count = 0
        pcm.withUnsafeBytes { raw in
            for sample in raw.bindMemory(to: Int16.self) {
                let normalized = Double(Int16(littleEndian: sample)) / 32768
                sum += normalized * normalized
                count += 1
            }
        }
        return count == 0 ? 0 : sqrt(sum / Double(count))
    }

    private nonisolated static func transcript(from data: Data) -> String {
        if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let text = payload["text"] as? String {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func stop(_ process: Process) {
        guard process.isRunning else { return }
        process.terminate()
    }
}

private extension Data {
    func chunked(maximumBytes: Int) -> [Data] {
        guard count > maximumBytes else { return [self] }
        return stride(from: startIndex, to: endIndex, by: maximumBytes).map { start in
            self[start..<Swift.min(start + maximumBytes, endIndex)]
        }
    }

    mutating func append(_ string: String) {
        append(contentsOf: string.utf8)
    }

    mutating func appendLittleEndian<T: FixedWidthInteger>(_ value: T) {
        var littleEndian = value.littleEndian
        Swift.withUnsafeBytes(of: &littleEndian) { append(contentsOf: $0) }
    }

    mutating func appendLittleEndian(_ value: Float32) {
        appendLittleEndian(value.bitPattern)
    }
}
