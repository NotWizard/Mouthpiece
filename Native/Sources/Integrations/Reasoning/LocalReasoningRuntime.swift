import Darwin
import Foundation

enum LocalReasoningRuntimeError: LocalizedError, Equatable {
    case binaryMissing
    case modelMissing(String)
    case noAvailablePort
    case launchFailed(String)
    case startupTimedOut

    var errorDescription: String? {
        switch self {
        case .binaryMissing: "The bundled llama-server runtime is missing. Reinstall Mouthpiece."
        case .modelMissing(let model): "The local reasoning model is not installed: \(model)."
        case .noAvailablePort: "No local reasoning server port is available."
        case .launchFailed(let message): "Local reasoning failed to start: \(message)"
        case .startupTimedOut: "Local reasoning did not become ready in time."
        }
    }
}

actor LocalReasoningRuntime {
    private struct RunningServer {
        let process: Process
        let port: Int
        let model: String
    }

    private let fileManager: FileManager
    private let session: URLSession
    private var server: RunningServer?

    init(fileManager: FileManager = .default, session: URLSession = .shared) {
        self.fileManager = fileManager
        self.session = session
    }

    func endpoint(model: String) async throws -> URL {
        if let server, server.model == model, server.process.isRunning,
           await isHealthy(port: server.port) {
            return URL(string: "http://127.0.0.1:\(server.port)/v1")!
        }
        stop()
        let started = try await start(model: model)
        return URL(string: "http://127.0.0.1:\(started.port)/v1")!
    }

    func stop() {
        guard let server else { return }
        if server.process.isRunning {
            server.process.terminate()
        }
        self.server = nil
    }

    private func start(model: String) async throws -> RunningServer {
        guard let descriptor = LocalReasoningModelCatalog.descriptor(id: model) else {
            throw LocalReasoningRuntimeError.modelMissing(model)
        }
        guard let binary = binaryURL() else { throw LocalReasoningRuntimeError.binaryMissing }
        guard let modelURL = installedModelURL(descriptor) else {
            throw LocalReasoningRuntimeError.modelMissing(descriptor.name)
        }
        guard let port = (8200...8220).first(where: Self.isPortAvailable) else {
            throw LocalReasoningRuntimeError.noAvailablePort
        }

        let process = Process()
        process.executableURL = binary
        process.arguments = [
            "--model", modelURL.path,
            "--host", "127.0.0.1",
            "--port", String(port),
            "--ctx-size", "4096",
            "--threads", String(max(1, min(6, ProcessInfo.processInfo.activeProcessorCount / 2))),
            "--n-gpu-layers", "99",
        ]
        process.currentDirectoryURL = fileManager.temporaryDirectory
        var environment = ProcessInfo.processInfo.environment
        let binaryDirectory = binary.deletingLastPathComponent().path
        environment["DYLD_LIBRARY_PATH"] = [binaryDirectory, environment["DYLD_LIBRARY_PATH"]]
            .compactMap(\.self)
            .joined(separator: ":")
        process.environment = environment
        let null = FileHandle(forWritingAtPath: "/dev/null")
        process.standardOutput = null
        process.standardError = null
        do {
            try process.run()
        } catch {
            throw LocalReasoningRuntimeError.launchFailed(error.localizedDescription)
        }
        let started = RunningServer(process: process, port: port, model: model)
        let deadline = ContinuousClock.now.advanced(by: .seconds(60))
        while ContinuousClock.now < deadline {
            guard process.isRunning else {
                throw LocalReasoningRuntimeError.launchFailed("llama-server exited during startup")
            }
            if await isHealthy(port: port) {
                server = started
                return started
            }
            try await Task.sleep(for: .milliseconds(200))
        }
        process.terminate()
        throw LocalReasoningRuntimeError.startupTimedOut
    }

    private func isHealthy(port: Int) async -> Bool {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/health")!)
        request.timeoutInterval = 2
        guard let (_, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse else { return false }
        return (200..<300).contains(http.statusCode)
    }

    private func installedModelURL(_ descriptor: LocalReasoningModelDescriptor) -> URL? {
        let candidates = [
            AppPaths.reasoningModelsDirectory.appendingPathComponent(descriptor.fileName),
            AppPaths.legacyReasoningModelsDirectory.appendingPathComponent(descriptor.fileName),
        ]
        return candidates.first { url in
            guard let size = try? fileManager.attributesOfItem(atPath: url.path)[.size] as? Int64 else {
                return false
            }
            return size >= max(1_000_000, descriptor.expectedSizeBytes * 7 / 10)
        }
    }

    private func binaryURL() -> URL? {
#if arch(arm64)
        let architecture = "arm64"
#else
        let architecture = "x64"
#endif
        let name = "llama-server-darwin-\(architecture)"
        let candidates = [
            Bundle.main.resourceURL?.appendingPathComponent("Binaries/llama/\(name)"),
            Bundle.main.resourceURL?.appendingPathComponent("bin/\(name)"),
            AppPaths.applicationSupportDirectory.appendingPathComponent("bin/\(name)"),
        ].compactMap { $0 }
        return candidates.first { fileManager.isExecutableFile(atPath: $0.path) }
    }

    private nonisolated static func isPortAvailable(_ port: Int) -> Bool {
        let socketDescriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard socketDescriptor >= 0 else { return false }
        defer { Darwin.close(socketDescriptor) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        return withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
    }
}
