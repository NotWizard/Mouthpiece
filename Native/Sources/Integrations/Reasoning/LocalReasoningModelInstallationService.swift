import Foundation

actor LocalReasoningModelInstallationService {
    private let fileManager: FileManager
    private let session: URLSession

    init(fileManager: FileManager = .default, session: URLSession = .shared) {
        self.fileManager = fileManager
        self.session = session
    }

    func isInstalled(model: String) -> Bool {
        guard let descriptor = LocalReasoningModelCatalog.descriptor(id: model) else { return false }
        return validModel(at: modelURL(descriptor), expectedSize: descriptor.expectedSizeBytes)
            || validModel(at: legacyModelURL(descriptor), expectedSize: descriptor.expectedSizeBytes)
    }

    func install(
        model: String,
        onState: @escaping @Sendable (ModelInstallationState) -> Void
    ) async throws {
        guard let descriptor = LocalReasoningModelCatalog.descriptor(id: model) else {
            throw ModelInstallationError.unknownModel
        }
        onState(.installing(model: model, detail: "Downloading \(descriptor.name)"))
        do {
            try fileManager.createDirectory(at: AppPaths.reasoningModelsDirectory, withIntermediateDirectories: true)
            let (temporary, response) = try await session.download(from: descriptor.downloadURL)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  validModel(at: temporary, expectedSize: descriptor.expectedSizeBytes) else {
                throw ModelInstallationError.invalidDownload
            }
            let destination = modelURL(descriptor)
            try? fileManager.removeItem(at: destination)
            try fileManager.moveItem(at: temporary, to: destination)
            onState(.installed(model: model))
        } catch {
            onState(.failed(model: model, message: error.localizedDescription))
            throw error
        }
    }

    func remove(model: String) throws {
        guard let descriptor = LocalReasoningModelCatalog.descriptor(id: model) else {
            throw ModelInstallationError.unknownModel
        }
        for url in [modelURL(descriptor), legacyModelURL(descriptor)]
            where fileManager.fileExists(atPath: url.path) {
            try fileManager.removeItem(at: url)
        }
    }

    private func validModel(at url: URL, expectedSize: Int64) -> Bool {
        guard let size = try? fileManager.attributesOfItem(atPath: url.path)[.size] as? Int64 else {
            return false
        }
        return size >= max(1_000_000, expectedSize * 7 / 10)
    }

    private func modelURL(_ descriptor: LocalReasoningModelDescriptor) -> URL {
        AppPaths.reasoningModelsDirectory.appendingPathComponent(descriptor.fileName)
    }

    private func legacyModelURL(_ descriptor: LocalReasoningModelDescriptor) -> URL {
        AppPaths.legacyReasoningModelsDirectory.appendingPathComponent(descriptor.fileName)
    }
}
