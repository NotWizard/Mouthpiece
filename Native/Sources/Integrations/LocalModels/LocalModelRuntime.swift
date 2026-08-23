import Accelerate
import Darwin
import Foundation

enum LocalModelRuntimeError: LocalizedError, Equatable {
    case binaryMissing(String)
    case binaryVerificationFailed(URL)
    case modelMissing(String)
    case unsupported(String)
    case noAvailablePort(ClosedRange<Int>)
    case launchFailed(String)
    case startupTimedOut(String)
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .binaryMissing(let name): "Required local runtime is missing: \(name)."
        case .binaryVerificationFailed(let url):
            "Refusing to launch local model binary from outside the app bundle: \(url.path)."
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
        var logURL: URL?
        /// Path to the runtime-state record for this server, so a graceful
        /// stop can remove it. Nil when writing the record failed (best
        /// effort — the reaper still handles crash-time orphans).
        var stateURL: URL?
    }

    private let session: URLSession
    private let fileManager: FileManager
    private var whisper: RunningServer?
    private var parakeet: RunningServer?
    private var qwen: RunningServer?
    /// Audit P1-10: reap orphan model-server subprocesses left behind by a
    /// previous crash/Force-Quit on the first ensure*() call of this
    /// instance. Guarded so a whisper spawn followed by a parakeet spawn
    /// does not rescan the runtime-state directory twice.
    private var didReapOrphans = false

    init(session: URLSession = .shared, fileManager: FileManager = .default) {
        self.session = session
        self.fileManager = fileManager
    }

    func status(provider: LocalTranscriptionProvider, model: String) -> LocalModelStatus {
        let binary = binaryURL(for: provider) != nil
        let modelURL = modelURL(for: provider, model: model)
        let downloaded = modelIsValid(provider: provider, model: model, url: modelURL)
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
        [whisper, parakeet, qwen].compactMap(\.self).forEach { stop($0) }
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
            defer { task.cancel(with: .normalClosure, reason: nil) }
            var message = Data()
            message.appendLittleEndian(Int32(16_000))
            let floatSamples = Self.float32Samples(fromPCM16: segment)
            message.appendLittleEndian(Int32(floatSamples.count))
            message.append(floatSamples)
            try await task.send(.data(message))
            // A wedged sherpa-onnx process (memory pressure, corrupt model)
            // otherwise leaves this receive waiting forever.
            let response = try await task.receive(timeout: .seconds(60))
            let text: String
            switch response {
            case .string(let value): text = value
            case .data(let value): text = String(decoding: value, as: UTF8.self)
            @unknown default: text = ""
            }
            try await task.send(.string("Done"))
            results.append(Self.transcript(from: Data(text.utf8)))
        }
        return results.filter { !$0.isEmpty }.joined(separator: " ")
    }

    private func ensureWhisper(model: String, language: String) async throws -> RunningServer {
        runReaperIfNeeded()
        if let whisper, whisper.process.isRunning, whisper.model == model { return whisper }
        if let whisper { stop(whisper) }
        guard let binary = binaryURL(for: .whisper) else {
            throw LocalModelRuntimeError.binaryMissing(Self.binaryName(for: .whisper))
        }
        let modelURL = modelURL(for: .whisper, model: model)
        guard modelIsValid(provider: .whisper, model: model, url: modelURL) else {
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
            model: model,
            kind: "whisper"
        )
        do {
            try await waitForHTTP(server: server, paths: ["/"], timeout: .seconds(60))
        } catch {
            stop(server)
            throw error
        }
        whisper = server
        return server
    }

    private func ensureParakeet(model: String) async throws -> RunningServer {
        runReaperIfNeeded()
        if let parakeet, parakeet.process.isRunning, parakeet.model == model { return parakeet }
        if let parakeet { stop(parakeet) }
        guard let binary = binaryURL(for: .parakeet) else {
            throw LocalModelRuntimeError.binaryMissing(Self.binaryName(for: .parakeet))
        }
        let modelURL = modelURL(for: .parakeet, model: model)
        guard modelIsValid(provider: .parakeet, model: model, url: modelURL) else {
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
            model: model,
            kind: "parakeet"
        )
        do {
            try await waitForPort(server: server, timeout: .seconds(60))
        } catch {
            stop(server)
            throw error
        }
        parakeet = server
        return server
    }

    private func ensureQwen(model: String) async throws -> RunningServer {
#if arch(arm64)
        runReaperIfNeeded()
        if let qwen, qwen.process.isRunning, qwen.model == model { return qwen }
        if let qwen { stop(qwen) }
        guard let binary = binaryURL(for: .qwen) else {
            throw LocalModelRuntimeError.binaryMissing(Self.binaryName(for: .qwen))
        }
        let modelURL = modelURL(for: .qwen, model: model)
        guard modelIsValid(provider: .qwen, model: model, url: modelURL) else {
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
            kind: "qwen",
            apiKey: apiKey,
            environment: environment
        )
        do {
            try await waitForHTTP(
                server: server,
                paths: ["/health", "/v1/models"],
                timeout: .seconds(120),
                bearerToken: apiKey
            )
        } catch {
            stop(server)
            throw error
        }
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
        kind: String,
        apiKey: String? = nil,
        environment: [String: String]? = nil
    ) throws -> RunningServer {
        // Pre-launch defence-in-depth (audit P1-9, option 3): refuse any
        // resolved binary that lives outside Bundle.main.resourceURL. The
        // release-mode candidate list already excludes such paths so this
        // is redundant in production, but the redundancy is cheap and
        // catches any future regression that reintroduces a writable
        // candidate. In DEBUG the check is off by default so engineers
        // can iterate against locally-built model servers; a unit test
        // flips `testForceBundleOnly` to exercise the release policy.
#if DEBUG
        let enforceContainment = Self.testForceBundleOnly
#else
        let enforceContainment = true
#endif
        if enforceContainment, !Self.isBinaryInsideMainBundle(executable) {
            throw LocalModelRuntimeError.binaryVerificationFailed(executable)
        }
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.currentDirectoryURL = FileManager.default.temporaryDirectory
        process.environment = environment
        // Discarding output made startup failures undiagnosable ("timed out"
        // with no clue); keep the last launch's log per model instead.
        var logURL: URL?
        let logDirectory = AppPaths.logsDirectory
        let candidate = logDirectory.appendingPathComponent("local-model-\(model).log")
        try? FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: candidate.path, contents: nil)
        if let handle = FileHandle(forWritingAtPath: candidate.path) {
            process.standardOutput = handle
            process.standardError = handle
            logURL = candidate
        } else {
            let null = FileHandle(forWritingAtPath: "/dev/null")
            process.standardOutput = null
            process.standardError = null
        }
        do {
            try process.run()
        } catch {
            throw LocalModelRuntimeError.launchFailed(error.localizedDescription)
        }
        // Audit P1-10: drop an OS-visible record of this child so the next
        // Mouthpiece launch (after a crash / Force Quit) can identify it
        // as an orphan and reap it before scanning ports.
        let stateURL = Self.writeRuntimeStateRecord(
            childPID: process.processIdentifier,
            port: port,
            executable: executable,
            model: model,
            kind: kind
        )
        return RunningServer(
            process: process,
            port: port,
            model: model,
            apiKey: apiKey,
            logURL: logURL,
            stateURL: stateURL
        )
    }

    private nonisolated static func startupDiagnostics(_ server: RunningServer) -> String {
        guard let logURL = server.logURL,
              let data = try? Data(contentsOf: logURL), !data.isEmpty else { return "" }
        let tail = String(decoding: data.suffix(600), as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return tail.isEmpty ? "" : " — \(tail)"
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
                throw LocalModelRuntimeError.launchFailed(
                    "process exited during startup" + Self.startupDiagnostics(server)
                )
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
        stop(server)
        throw LocalModelRuntimeError.startupTimedOut(server.model + Self.startupDiagnostics(server))
    }

    private func waitForPort(server: RunningServer, timeout: Duration) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: timeout)
        while clock.now < deadline {
            guard server.process.isRunning else {
                throw LocalModelRuntimeError.launchFailed(
                    "process exited during startup" + Self.startupDiagnostics(server)
                )
            }
            if !Self.isPortAvailable(server.port) { return }
            try await Task.sleep(for: .milliseconds(100))
        }
        stop(server)
        throw LocalModelRuntimeError.startupTimedOut(server.model + Self.startupDiagnostics(server))
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
        return candidates.first { modelIsValid(provider: provider, model: model, url: $0) } ?? candidates[0]
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

    private func modelIsValid(provider: LocalTranscriptionProvider, model: String, url: URL) -> Bool {
        switch provider {
        case .whisper:
            guard let descriptor = LocalModelCatalog.descriptor(provider: .whisper, id: model) else {
                return false
            }
            return LocalModelInstallationService.whisperModelIsComplete(
                url,
                expectedSizeBytes: descriptor.expectedSizeBytes,
                fileManager: fileManager
            )
        case .parakeet:
            return LocalModelInstallationService.parakeetModelIsComplete(url, fileManager: fileManager)
        case .qwen:
            return LocalModelInstallationService.qwenCacheIsComplete(url, fileManager: fileManager)
        }
    }

    private func binaryURL(for provider: LocalTranscriptionProvider) -> URL? {
        Self.binaryCandidateURLs(for: provider).first {
            fileManager.isExecutableFile(atPath: $0.path)
        }
    }

    // MARK: - Binary resolution (audit P1-9 defence-in-depth)

    /// Enumerates the search order for a model-server binary. Bundle
    /// candidates ALWAYS come first; user-writable development paths only
    /// exist in `#if DEBUG` builds so a release-build attacker who can write
    /// to Application Support / the working directory / the legacy qwen
    /// runtime cache cannot preempt the shipped binary and inherit the
    /// Microphone + Accessibility TCC grants (plus
    /// `disable-library-validation`). Nonisolated so unit tests can inspect
    /// the resolution order without spinning up the actor.
    nonisolated static func binaryCandidateURLs(
        for provider: LocalTranscriptionProvider,
        bundle: Bundle = .main
    ) -> [URL] {
        let name = binaryName(for: provider)
        var bundleCandidates: [URL] = []
        if let resourceURL = bundle.resourceURL {
            bundleCandidates.append(resourceURL.appendingPathComponent("bin/\(name)"))
            bundleCandidates.append(
                resourceURL
                    .appendingPathComponent("Binaries/\(runtimeDirectory(for: provider))/\(name)")
            )
            bundleCandidates.append(resourceURL.appendingPathComponent(name))
        }
        var developmentCandidates: [URL] = []
#if DEBUG
        if !testForceBundleOnly {
            // Development-only: engineers can point at a locally-built
            // model server without repacking Mouthpiece.app. These paths
            // are user-writable so RELEASE builds MUST NOT reach them —
            // the entire block is compiled out. In DEBUG a test seam
            // (`testForceBundleOnly`) can force the release policy so the
            // regression test asserts the same shape production ships.
            if provider == .qwen {
                developmentCandidates.append(
                    AppPaths.qwenASRRuntimeDirectory.appendingPathComponent("bin/\(name)")
                )
                developmentCandidates.append(
                    AppPaths.legacyQwenASRRuntimeDirectory.appendingPathComponent("bin/\(name)")
                )
            }
            developmentCandidates.append(
                AppPaths.applicationSupportDirectory.appendingPathComponent("bin/\(name)")
            )
            developmentCandidates.append(
                URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
                    .appendingPathComponent("resources/bin/\(name)")
            )
        }
#endif
        if provider == .whisper {
            // Legacy whisper.cpp builds shipped a bare `whisper-server`
            // binary; check the alias next to every real candidate.
            bundleCandidates.append(contentsOf: bundleCandidates.map {
                $0.deletingLastPathComponent().appendingPathComponent("whisper-server")
            })
            developmentCandidates.append(contentsOf: developmentCandidates.map {
                $0.deletingLastPathComponent().appendingPathComponent("whisper-server")
            })
        }
        return bundleCandidates + developmentCandidates
    }

    /// True when `url` resolves to a path inside `bundle.resourceURL`. Used
    /// as the release-mode candidate filter AND the pre-launch containment
    /// check. Chosen over a full `SecStaticCode` + requirement chain
    /// (option 2 of the audit) because the app is self-signed and
    /// unnotarised — there is no stable Team ID to pin, and the model
    /// servers are separately-built binaries whose cdhash differs from the
    /// host's. Structural path containment is the decisive gain here.
    nonisolated static func isBinaryInsideMainBundle(
        _ url: URL,
        bundle: Bundle = .main
    ) -> Bool {
        guard let resourceURL = bundle.resourceURL?.standardizedFileURL else { return false }
        let base = resourceURL.path
        let target = url.standardizedFileURL.path
        // The trailing "/" prevents a sibling path that only prefixes the
        // resource-URL string (e.g. `.../Contents/Resources.evil/...`) from
        // sneaking through.
        return target == base || target.hasPrefix(base + "/")
    }

#if DEBUG
    /// Test-only seam. When `true`, `binaryCandidateURLs(for:)` behaves as
    /// in a release build (bundle candidates only) and `launch(...)`
    /// enforces the pre-launch containment check. Production code never
    /// touches this — flipping it in a release build has no effect because
    /// the whole `#if DEBUG` block is absent.
    nonisolated(unsafe) static var testForceBundleOnly: Bool = false
#endif

    private nonisolated static func runtimeDirectory(for provider: LocalTranscriptionProvider) -> String {
        switch provider {
        case .whisper: "whisper"
        case .parakeet: "parakeet"
        case .qwen: "qwen"
        }
    }

    private nonisolated static func binaryName(for provider: LocalTranscriptionProvider) -> String {
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
        let count = pcm.count / MemoryLayout<Int16>.size
        guard count > 0 else { return Data() }
        var floats = [Float](repeating: 0, count: count)
        pcm.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            vDSP_vflt16(samples.baseAddress!, 1, &floats, 1, vDSP_Length(count))
        }
        var scale = Float(1.0 / 32768.0)
        vDSP_vsmul(floats, 1, &scale, &floats, 1, vDSP_Length(count))
        return floats.withUnsafeBufferPointer { Data(buffer: $0) }
    }

    private nonisolated static func rms(ofPCM16 pcm: Data) -> Double {
        let count = pcm.count / MemoryLayout<Int16>.size
        guard count > 0 else { return 0 }
        var floats = [Float](repeating: 0, count: count)
        pcm.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            vDSP_vflt16(samples.baseAddress!, 1, &floats, 1, vDSP_Length(count))
        }
        var meanSquare: Float = 0
        vDSP_measqv(floats, 1, &meanSquare, vDSP_Length(count))
        return sqrt(Double(meanSquare)) / 32768.0
    }

    private nonisolated static func transcript(from data: Data) -> String {
        if let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let text = payload["text"] as? String {
            return text.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func stop(_ server: RunningServer) {
        Self.terminate(server.process)
        // Audit P1-10: a graceful stop removes the runtime-state record so
        // the next launch's reaper does not chase a pid we already killed.
        if let stateURL = server.stateURL {
            try? fileManager.removeItem(at: stateURL)
        }
    }

    nonisolated static func terminate(_ process: Process, gracePeriod: TimeInterval = 0.5) {
        guard process.isRunning else { return }
        process.terminate()
        let deadline = Date().addingTimeInterval(gracePeriod)
        while process.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.01)
        }
        if process.isRunning {
            Darwin.kill(process.processIdentifier, SIGKILL)
        }
        process.waitUntilExit()
    }

    // MARK: - Orphan reaper (audit P1-10)

    /// Serialised on disk under `AppPaths.runtimeStateDirectory` as
    /// `<kind>-<childPID>.json`. `ownerPID` identifies the Mouthpiece
    /// process that spawned the server; on the next launch the reaper
    /// treats a missing `ownerPID` as evidence the previous parent
    /// crashed / was Force Quit and the child reparented to launchd.
    private struct RuntimeStateRecord: Codable {
        let ownerPID: Int32
        let port: Int
        let executable: String
        let model: String
        let launchedAt: Date
    }

    /// Writes the runtime-state record atomically. Failure is best-effort
    /// (still returns nil) — the child is already running and the reaper
    /// only depends on the file when a graceful stop cannot happen.
    private nonisolated static func writeRuntimeStateRecord(
        childPID: Int32,
        port: Int,
        executable: URL,
        model: String,
        kind: String
    ) -> URL? {
        let directory = AppPaths.runtimeStateDirectory
        do {
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true
            )
            let record = RuntimeStateRecord(
                ownerPID: ProcessInfo.processInfo.processIdentifier,
                port: port,
                executable: executable.path,
                model: model,
                launchedAt: Date()
            )
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .secondsSince1970
            let data = try encoder.encode(record)
            let url = directory.appendingPathComponent("\(kind)-\(childPID).json")
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private func runReaperIfNeeded() {
        guard !didReapOrphans else { return }
        didReapOrphans = true
        Self.reapOrphanServers()
    }

    /// Scans `directory` for runtime-state records whose owning Mouthpiece
    /// process no longer exists (crash / Force Quit / kernel kill), and
    /// terminates the recorded child process before deleting the file. Safe
    /// to call multiple times; idempotent when no orphans exist. Runs
    /// entirely off the actor so a whisper spawn can reap parakeet/qwen
    /// orphans and vice versa.
    nonisolated static func reapOrphanServers(
        directory: URL = AppPaths.runtimeStateDirectory,
        fileManager: FileManager = .default
    ) {
        guard let entries = try? fileManager.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: nil
        ) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        for url in entries where url.pathExtension == "json" {
            guard let data = try? Data(contentsOf: url),
                  let record = try? decoder.decode(RuntimeStateRecord.self, from: data)
            else { continue }
            // kill(_, 0) is the canonical liveness probe: success (0) means
            // the pid exists and we may signal it; ESRCH means the previous
            // owner is definitely gone and its children are orphans. Any
            // other errno (EPERM etc.) is conservative → skip.
            if Darwin.kill(record.ownerPID, 0) == 0 { continue }
            if errno != ESRCH { continue }
            defer { try? fileManager.removeItem(at: url) }
            // Extract the child pid from the filename (`<kind>-<pid>.json`).
            let base = url.deletingPathExtension().lastPathComponent
            guard let dash = base.lastIndex(of: "-"),
                  let childPID = Int32(base[base.index(after: dash)...]),
                  childPID > 0
            else { continue }
            // PID reuse: if the OS has already recycled the pid to a
            // different program, do NOT signal it — we could kill a shell,
            // an editor, anything. proc_pidpath is the resolving check.
            guard Self.pidHasExecutable(childPID, expected: record.executable) else { continue }
            _ = Darwin.kill(childPID, SIGTERM)
            let deadline = Date().addingTimeInterval(0.5)
            while Date() < deadline {
                if Darwin.kill(childPID, 0) != 0, errno == ESRCH { break }
                Thread.sleep(forTimeInterval: 0.02)
            }
            if Darwin.kill(childPID, 0) == 0 {
                _ = Darwin.kill(childPID, SIGKILL)
            }
        }
    }

    /// True when `proc_pidpath(pid)` resolves to `expected`. Used to defend
    /// against PID reuse before signalling a recorded child.
    private nonisolated static func pidHasExecutable(_ pid: Int32, expected: String) -> Bool {
        // PROC_PIDPATHINFO_MAXSIZE is 4 * MAXPATHLEN (4096) on macOS.
        let capacity = 4096
        var buffer = [Int8](repeating: 0, count: capacity)
        let length = buffer.withUnsafeMutableBufferPointer { ptr -> Int32 in
            guard let base = ptr.baseAddress else { return 0 }
            return proc_pidpath(pid, UnsafeMutableRawPointer(base), UInt32(capacity))
        }
        guard length > 0 else { return false }
        return String(cString: buffer) == expected
    }
}

/// libproc.h forward declaration — avoids a bridging-header change just to
/// resolve one symbol used by the orphan reaper.
@_silgen_name("proc_pidpath")
private func proc_pidpath(
    _ pid: pid_t,
    _ buffer: UnsafeMutableRawPointer?,
    _ buffersize: UInt32
) -> Int32

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
