import Foundation

enum ModelInstallationState: Equatable, Sendable {
    case idle
    case installing(model: String, detail: String)
    case installed(model: String)
    case failed(model: String, message: String)
}

enum ModelInstallationError: LocalizedError {
    case unknownModel
    case invalidDownload
    case pythonMissing
    case commandFailed(String)
    case unsupported
    case operationInProgress

    var errorDescription: String? {
        switch self {
        case .unknownModel: "The selected local model is not supported."
        case .invalidDownload: "The downloaded model failed validation."
        case .pythonMissing: "Python 3.10 or newer is required to install Qwen ASR MLX."
        case .commandFailed(let message): message
        case .unsupported: "Qwen ASR MLX requires an Apple Silicon Mac."
        case .operationInProgress: "Another local model operation is already in progress."
        }
    }
}

actor LocalModelInstallationService {
    private let fileManager: FileManager
    private let download: @Sendable (URL) async throws -> (URL, URLResponse)
    private var operationInProgress = false

    init(fileManager: FileManager = .default, session: URLSession? = nil) {
        self.fileManager = fileManager
        let session = session ?? {
            let configuration = URLSessionConfiguration.default
            // URLSession.shared allows 7 days per resource; a stalled 3 GB
            // model download should fail and become retryable the same day.
            configuration.timeoutIntervalForResource = 2 * 60 * 60
            return URLSession(configuration: configuration)
        }()
        download = { try await session.download(from: $0) }
    }

    init(
        fileManager: FileManager = .default,
        download: @escaping @Sendable (URL) async throws -> (URL, URLResponse)
    ) {
        self.fileManager = fileManager
        self.download = download
    }

    func isInstalled(provider: LocalTranscriptionProvider, model: String) -> Bool {
        guard let descriptor = LocalModelCatalog.descriptor(provider: provider, id: model) else { return false }
        switch provider {
        case .whisper:
            return whisperURLs(descriptor).contains {
                Self.whisperModelIsComplete(
                    $0,
                    expectedSizeBytes: descriptor.expectedSizeBytes,
                    fileManager: fileManager
                )
            }
        case .parakeet:
            return [AppPaths.parakeetModelsDirectory, AppPaths.legacyParakeetModelsDirectory].contains { root in
                let directory = root.appendingPathComponent(model)
                return Self.parakeetModelIsComplete(directory, fileManager: fileManager)
            }
        case .qwen:
            return [AppPaths.qwenASRModelsDirectory, AppPaths.legacyQwenASRModelsDirectory].contains { root in
                let cache = qwenCacheURL(descriptor, root: root)
                return Self.qwenCacheIsComplete(cache, fileManager: fileManager)
            }
        }
    }

    nonisolated static func whisperModelIsComplete(
        _ url: URL,
        expectedSizeBytes: Int64,
        fileManager: FileManager = .default
    ) -> Bool {
        guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
              let size = attributes[.size] as? NSNumber,
              size.int64Value >= expectedSizeBytes * 95 / 100 else { return false }
        // ggml magic 0x67676d6c (little-endian "lmgg" on disk): a truncated
        // download or an HTML error page saved by the CDN passes a size-only
        // check and then crashes whisper.cpp at model load.
        guard let handle = FileHandle(forReadingAtPath: url.path) else { return false }
        defer { try? handle.close() }
        guard let header = try? handle.read(upToCount: 4), header.count == 4 else { return false }
        return header == Data([0x6C, 0x6D, 0x67, 0x67])
    }

    nonisolated static func parakeetModelIsComplete(
        _ directory: URL,
        fileManager: FileManager = .default
    ) -> Bool {
        requiredParakeetFiles.allSatisfy { filename in
            let url = directory.appendingPathComponent(filename)
            guard let attributes = try? fileManager.attributesOfItem(atPath: url.path),
                  let size = attributes[.size] as? NSNumber else { return false }
            return size.int64Value > 0
        }
    }

    nonisolated static func qwenCacheIsComplete(
        _ cache: URL,
        fileManager: FileManager = .default
    ) -> Bool {
        let reference = cache.appendingPathComponent("refs/main")
        guard let revision = try? String(contentsOf: reference, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
              !revision.isEmpty else { return false }
        let snapshot = cache.appendingPathComponent("snapshots/\(revision)", isDirectory: true)
        guard fileManager.fileExists(atPath: snapshot.appendingPathComponent("config.json").path),
              let enumerator = fileManager.enumerator(at: snapshot, includingPropertiesForKeys: nil) else {
            return false
        }
        let weightExtensions: Set<String> = ["safetensors", "bin", "npz"]
        return enumerator.contains { item in
            guard let url = item as? URL else { return false }
            return weightExtensions.contains(url.pathExtension.lowercased())
        }
    }

    func install(
        provider: LocalTranscriptionProvider,
        model: String,
        onState: @escaping @Sendable (ModelInstallationState) -> Void
    ) async throws {
        try beginOperation()
        defer { operationInProgress = false }
        guard let descriptor = LocalModelCatalog.descriptor(provider: provider, id: model) else {
            throw ModelInstallationError.unknownModel
        }
        do {
            switch provider {
            case .whisper:
                onState(.installing(model: model, detail: "Downloading model"))
                try await installWhisper(descriptor)
            case .parakeet:
                onState(.installing(model: model, detail: "Downloading model"))
                try await installParakeet(descriptor, onState: onState)
            case .qwen:
                try await installQwen(descriptor, onState: onState)
            }
            onState(.installed(model: model))
        } catch {
            onState(.failed(model: model, message: error.localizedDescription))
            throw error
        }
    }

    func remove(provider: LocalTranscriptionProvider, model: String) throws {
        try beginOperation()
        defer { operationInProgress = false }
        guard let descriptor = LocalModelCatalog.descriptor(provider: provider, id: model) else {
            throw ModelInstallationError.unknownModel
        }
        let targets: [URL]
        switch provider {
        case .whisper: targets = whisperURLs(descriptor)
        case .parakeet:
            targets = [AppPaths.parakeetModelsDirectory, AppPaths.legacyParakeetModelsDirectory]
                .map { $0.appendingPathComponent(model) }
        case .qwen:
            targets = [AppPaths.qwenASRModelsDirectory, AppPaths.legacyQwenASRModelsDirectory]
                .map { qwenCacheURL(descriptor, root: $0) }
        }
        for target in targets where fileManager.fileExists(atPath: target.path) {
            try fileManager.removeItem(at: target)
        }
    }

    private func beginOperation() throws {
        guard !operationInProgress else { throw ModelInstallationError.operationInProgress }
        operationInProgress = true
    }

    private func installWhisper(_ descriptor: LocalModelDescriptor) async throws {
        guard let remote = descriptor.downloadURL else { throw ModelInstallationError.unknownModel }
        try fileManager.createDirectory(at: AppPaths.whisperModelsDirectory, withIntermediateDirectories: true)
        let (temporary, response) = try await download(remote)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              Self.whisperModelIsComplete(
                  temporary,
                  expectedSizeBytes: descriptor.expectedSizeBytes,
                  fileManager: fileManager
              ) else {
            throw ModelInstallationError.invalidDownload
        }
        let destination = whisperURL(descriptor)
        try? fileManager.removeItem(at: destination)
        try fileManager.moveItem(at: temporary, to: destination)
    }

    private func installParakeet(
        _ descriptor: LocalModelDescriptor,
        onState: @escaping @Sendable (ModelInstallationState) -> Void
    ) async throws {
        guard let remote = descriptor.downloadURL else { throw ModelInstallationError.unknownModel }
        try fileManager.createDirectory(at: AppPaths.parakeetModelsDirectory, withIntermediateDirectories: true)
        let (archive, response) = try await download(remote)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ModelInstallationError.invalidDownload
        }
        let staging = fileManager.temporaryDirectory
            .appendingPathComponent("Mouthpiece-Parakeet-\(UUID().uuidString)", isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: staging) }
        let localArchive = staging.appendingPathComponent("model.tar.bz2")
        try fileManager.moveItem(at: archive, to: localArchive)
        onState(.installing(model: descriptor.id, detail: "Extracting model"))
        try await ProcessCommand.run(
            executable: URL(fileURLWithPath: "/usr/bin/tar"),
            arguments: ["-xjf", localArchive.path, "-C", staging.path]
        )
        let extracted = try findDirectory(containing: Self.requiredParakeetFiles, under: staging)
        let destination = AppPaths.parakeetModelsDirectory.appendingPathComponent(descriptor.id)
        try? fileManager.removeItem(at: destination)
        try fileManager.moveItem(at: extracted, to: destination)
        guard isInstalled(provider: .parakeet, model: descriptor.id) else {
            throw ModelInstallationError.invalidDownload
        }
    }

    private func installQwen(
        _ descriptor: LocalModelDescriptor,
        onState: @escaping @Sendable (ModelInstallationState) -> Void
    ) async throws {
#if arch(arm64)
        guard let python = try await supportedPython() else { throw ModelInstallationError.pythonMissing }
        try fileManager.createDirectory(at: AppPaths.cacheDirectory, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: AppPaths.qwenASRModelsDirectory, withIntermediateDirectories: true)
        let runtimePython = AppPaths.qwenASRRuntimeDirectory.appendingPathComponent("bin/python")
        if !fileManager.fileExists(atPath: runtimePython.path) {
            onState(.installing(model: descriptor.id, detail: "Creating MLX runtime"))
            try await ProcessCommand.run(
                executable: python,
                arguments: ["-m", "venv", AppPaths.qwenASRRuntimeDirectory.path],
                timeout: .seconds(120)
            )
        }
        onState(.installing(model: descriptor.id, detail: "Installing MLX runtime"))
        try await ProcessCommand.run(
            executable: runtimePython,
            arguments: ["-m", "pip", "install", "--upgrade", "pip", "mlx-qwen3-asr[serve]"],
            environment: qwenEnvironment(),
            timeout: .seconds(900)
        )
        guard let remoteModelID = descriptor.remoteModelID else { throw ModelInstallationError.unknownModel }
        onState(.installing(model: descriptor.id, detail: "Downloading model"))
        let script = "from huggingface_hub import snapshot_download; import sys; snapshot_download(repo_id=sys.argv[1], cache_dir=sys.argv[2])"
        try await ProcessCommand.run(
            executable: runtimePython,
            arguments: ["-c", script, remoteModelID, AppPaths.qwenASRModelsDirectory.appendingPathComponent("hub").path],
            environment: qwenEnvironment(),
            timeout: .seconds(1_800)
        )
        guard isInstalled(provider: .qwen, model: descriptor.id) else {
            throw ModelInstallationError.invalidDownload
        }
#else
        throw ModelInstallationError.unsupported
#endif
    }

    private func supportedPython() async throws -> URL? {
        let candidates = [
            "/opt/homebrew/bin/python3.12", "/opt/homebrew/bin/python3.11", "/opt/homebrew/bin/python3.10",
            "/usr/local/bin/python3.12", "/usr/local/bin/python3.11", "/usr/local/bin/python3.10",
            "/usr/bin/python3",
        ]
        for candidate in candidates where fileManager.isExecutableFile(atPath: candidate) {
            let output = try? await ProcessCommand.output(
                executable: URL(fileURLWithPath: candidate),
                arguments: ["--version"],
                timeout: .seconds(5)
            )
            if let output,
               let match = output.firstMatch(of: /Python (\d+)\.(\d+)/),
               let major = Int(match.1), let minor = Int(match.2),
               major > 3 || (major == 3 && minor >= 10) {
                return URL(fileURLWithPath: candidate)
            }
        }
        return nil
    }

    private func qwenEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["HF_HOME"] = AppPaths.qwenASRModelsDirectory.path
        environment["HF_HUB_CACHE"] = AppPaths.qwenASRModelsDirectory.appendingPathComponent("hub").path
        environment["HUGGINGFACE_HUB_CACHE"] = environment["HF_HUB_CACHE"]
        environment["TOKENIZERS_PARALLELISM"] = "false"
        return environment
    }

    private func whisperURL(_ descriptor: LocalModelDescriptor) -> URL {
        whisperURLs(descriptor)[0]
    }

    private func whisperURLs(_ descriptor: LocalModelDescriptor) -> [URL] {
        let filename: String
        switch descriptor.id {
        case "large": filename = "ggml-large-v3.bin"
        case "turbo": filename = "ggml-large-v3-turbo.bin"
        default: filename = "ggml-\(descriptor.id).bin"
        }
        return [AppPaths.whisperModelsDirectory, AppPaths.legacyWhisperModelsDirectory]
            .map { $0.appendingPathComponent(filename) }
    }

    private func qwenCacheURL(
        _ descriptor: LocalModelDescriptor,
        root: URL = AppPaths.qwenASRModelsDirectory
    ) -> URL {
        root
            .appendingPathComponent("hub", isDirectory: true)
            .appendingPathComponent("models--\((descriptor.remoteModelID ?? "").replacingOccurrences(of: "/", with: "--"))", isDirectory: true)
    }

    private nonisolated static let requiredParakeetFiles: [String] =
        ["tokens.txt", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx"]

    private func findDirectory(containing files: [String], under root: URL) throws -> URL {
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) else { throw ModelInstallationError.invalidDownload }
        for case let url as URL in enumerator {
            guard (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            if files.allSatisfy({ fileManager.fileExists(atPath: url.appendingPathComponent($0).path) }) {
                return url
            }
        }
        throw ModelInstallationError.invalidDownload
    }
}

final class ProcessCommand: @unchecked Sendable {
    private let executable: URL
    private let arguments: [String]
    private let environment: [String: String]?
    private let timeout: Duration

    private init(
        executable: URL,
        arguments: [String],
        environment: [String: String]?,
        timeout: Duration
    ) {
        self.executable = executable
        self.arguments = arguments
        self.environment = environment
        self.timeout = timeout
    }

    static func run(
        executable: URL,
        arguments: [String],
        environment: [String: String]? = nil,
        timeout: Duration = .seconds(300)
    ) async throws {
        _ = try await ProcessCommand(
            executable: executable,
            arguments: arguments,
            environment: environment,
            timeout: timeout
        ).execute()
    }

    static func output(
        executable: URL,
        arguments: [String],
        timeout: Duration
    ) async throws -> String {
        try await ProcessCommand(
            executable: executable,
            arguments: arguments,
            environment: nil,
            timeout: timeout
        ).execute()
    }

    private func execute() async throws -> String {
        let process = Process()
        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-Command-\(UUID().uuidString).log")
        FileManager.default.createFile(atPath: outputURL.path, contents: nil)
        let outputHandle = try FileHandle(forWritingTo: outputURL)
        defer { try? FileManager.default.removeItem(at: outputURL) }
        process.executableURL = executable
        process.arguments = arguments
        process.environment = environment
        process.standardOutput = outputHandle
        process.standardError = outputHandle
        do {
            try process.run()
        } catch {
            try? outputHandle.close()
            throw error
        }
        return try await withTaskCancellationHandler {
            try await withThrowingTaskGroup(of: String.self) { group in
                group.addTask {
                    process.waitUntilExit()
                    try? outputHandle.close()
                    try Task.checkCancellation()
                    let data = (try? Data(contentsOf: outputURL)) ?? Data()
                    let output = String(decoding: data, as: UTF8.self)
                    guard process.terminationStatus == 0 else {
                        let message = output.trimmingCharacters(in: .whitespacesAndNewlines)
                        throw ModelInstallationError.commandFailed(message.isEmpty ? "Command failed." : message)
                    }
                    return output
                }
                group.addTask {
                    try await Task.sleep(for: self.timeout)
                    if process.isRunning { process.terminate() }
                    throw ModelInstallationError.commandFailed("Command timed out.")
                }
                let result = try await group.next()!
                group.cancelAll()
                return result
            }
        } onCancel: {
            if process.isRunning {
                process.terminate()
            }
        }
    }
}
