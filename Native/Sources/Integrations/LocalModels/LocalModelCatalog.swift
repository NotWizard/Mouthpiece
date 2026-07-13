import Foundation

struct LocalModelDescriptor: Identifiable, Equatable, Sendable {
    let id: String
    let provider: LocalTranscriptionProvider
    let displayName: String
    let sizeLabel: String
    let downloadURL: URL?
    let expectedSizeBytes: Int64
    let remoteModelID: String?
}

enum LocalModelCatalog {
    static let models: [LocalModelDescriptor] = [
        whisper("tiny", name: "Whisper Tiny", size: "75 MB", bytes: 78_000_000),
        whisper("base", name: "Whisper Base", size: "142 MB", bytes: 148_000_000),
        whisper("small", name: "Whisper Small", size: "466 MB", bytes: 488_000_000),
        whisper("medium", name: "Whisper Medium", size: "1.5 GB", bytes: 1_570_000_000),
        whisper("large", file: "ggml-large-v3.bin", name: "Whisper Large v3", size: "3 GB", bytes: 3_140_000_000),
        whisper("turbo", file: "ggml-large-v3-turbo.bin", name: "Whisper Large v3 Turbo", size: "1.6 GB", bytes: 1_670_000_000),
        LocalModelDescriptor(
            id: "parakeet-tdt-0.6b-v3",
            provider: .parakeet,
            displayName: "Parakeet TDT 0.6B",
            sizeLabel: "680 MB",
            downloadURL: URL(string: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2"),
            expectedSizeBytes: 500_000_000,
            remoteModelID: nil
        ),
        LocalModelDescriptor(
            id: "qwen3-asr-0.6b-mlx",
            provider: .qwen,
            displayName: "Qwen3-ASR 0.6B MLX",
            sizeLabel: "1.2 GB",
            downloadURL: nil,
            expectedSizeBytes: 1_200_000_000,
            remoteModelID: "Qwen/Qwen3-ASR-0.6B"
        ),
        LocalModelDescriptor(
            id: "qwen3-asr-1.7b-mlx",
            provider: .qwen,
            displayName: "Qwen3-ASR 1.7B MLX",
            sizeLabel: "3.4 GB",
            downloadURL: nil,
            expectedSizeBytes: 3_400_000_000,
            remoteModelID: "Qwen/Qwen3-ASR-1.7B"
        ),
    ]

    static func models(for provider: LocalTranscriptionProvider) -> [LocalModelDescriptor] {
        models.filter { $0.provider == provider }
    }

    static func descriptor(provider: LocalTranscriptionProvider, id: String) -> LocalModelDescriptor? {
        models.first { $0.provider == provider && $0.id == id }
    }

    private static func whisper(
        _ id: String,
        file: String? = nil,
        name: String,
        size: String,
        bytes: Int64
    ) -> LocalModelDescriptor {
        let filename = file ?? "ggml-\(id).bin"
        return LocalModelDescriptor(
            id: id,
            provider: .whisper,
            displayName: name,
            sizeLabel: size,
            downloadURL: URL(string: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/\(filename)"),
            expectedSizeBytes: bytes,
            remoteModelID: nil
        )
    }
}
