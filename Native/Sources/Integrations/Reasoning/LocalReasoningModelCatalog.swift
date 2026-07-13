import Foundation

struct LocalReasoningModelDescriptor: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let size: String
    let expectedSizeBytes: Int64
    let fileName: String
    let repository: String
    let recommended: Bool

    var downloadURL: URL {
        URL(string: "https://huggingface.co/\(repository)/resolve/main/\(fileName)")!
    }
}

enum LocalReasoningModelCatalog {
    static let models: [LocalReasoningModelDescriptor] = [
        .init(id: "qwen3-8b-q4_k_m", name: "Qwen3 8B", size: "5.0 GB", expectedSizeBytes: 5_402_263_552, fileName: "Qwen3-8B-Q4_K_M.gguf", repository: "Qwen/Qwen3-8B-GGUF", recommended: true),
        .init(id: "qwen3-8b-q5_k_m", name: "Qwen3 8B (Q5)", size: "5.9 GB", expectedSizeBytes: 6_281_625_600, fileName: "Qwen3-8B-Q5_K_M.gguf", repository: "Qwen/Qwen3-8B-GGUF", recommended: false),
        .init(id: "qwen3-4b-q4_k_m", name: "Qwen3 4B", size: "2.5 GB", expectedSizeBytes: 2_684_354_560, fileName: "Qwen3-4B-Q4_K_M.gguf", repository: "Qwen/Qwen3-4B-GGUF", recommended: true),
        .init(id: "qwen3-1.7b-q8_0", name: "Qwen3 1.7B", size: "1.8 GB", expectedSizeBytes: 1_965_555_712, fileName: "Qwen3-1.7B-Q8_0.gguf", repository: "Qwen/Qwen3-1.7B-GGUF", recommended: true),
        .init(id: "qwen3-0.6b-q8_0", name: "Qwen3 0.6B", size: "0.6 GB", expectedSizeBytes: 686_817_280, fileName: "Qwen3-0.6B-Q8_0.gguf", repository: "Qwen/Qwen3-0.6B-GGUF", recommended: false),
        .init(id: "qwen3-32b-q4_k_m", name: "Qwen3 32B", size: "19.8 GB", expectedSizeBytes: 21_260_251_955, fileName: "Qwen3-32B-Q4_K_M.gguf", repository: "Qwen/Qwen3-32B-GGUF", recommended: false),
        .init(id: "qwen2.5-0.5b-instruct-q5_k_m", name: "Qwen2.5 0.5B", size: "0.5 GB", expectedSizeBytes: 548_405_248, fileName: "qwen2.5-0.5b-instruct-q5_k_m.gguf", repository: "Qwen/Qwen2.5-0.5B-Instruct-GGUF", recommended: false),
        .init(id: "qwen2.5-1.5b-instruct-q5_k_m", name: "Qwen2.5 1.5B", size: "1.3 GB", expectedSizeBytes: 1_395_864_371, fileName: "qwen2.5-1.5b-instruct-q5_k_m.gguf", repository: "Qwen/Qwen2.5-1.5B-Instruct-GGUF", recommended: false),
        .init(id: "qwen2.5-3b-instruct-q5_k_m", name: "Qwen2.5 3B", size: "2.4 GB", expectedSizeBytes: 2_620_055_552, fileName: "qwen2.5-3b-instruct-q5_k_m.gguf", repository: "Qwen/Qwen2.5-3B-Instruct-GGUF", recommended: false),
        .init(id: "qwen2.5-7b-instruct-q4_k_m", name: "Qwen2.5 7B", size: "4.7 GB", expectedSizeBytes: 5_025_128_858, fileName: "Qwen2.5-7B-Instruct-Q4_K_M.gguf", repository: "bartowski/Qwen2.5-7B-Instruct-GGUF", recommended: false),
        .init(id: "qwen2.5-7b-instruct-q5_k_m", name: "Qwen2.5 7B (Q5)", size: "5.4 GB", expectedSizeBytes: 5_841_530_470, fileName: "Qwen2.5-7B-Instruct-Q5_K_M.gguf", repository: "bartowski/Qwen2.5-7B-Instruct-GGUF", recommended: false),
        .init(id: "mistral-7b-instruct-v0.3-q4_k_m", name: "Mistral 7B Instruct", size: "4.4 GB", expectedSizeBytes: 4_692_635_648, fileName: "Mistral-7B-Instruct-v0.3-Q4_K_M.gguf", repository: "bartowski/Mistral-7B-Instruct-v0.3-GGUF", recommended: true),
        .init(id: "mistral-7b-instruct-v0.3-q5_k_m", name: "Mistral 7B Instruct (Q5)", size: "5.1 GB", expectedSizeBytes: 5_519_900_672, fileName: "Mistral-7B-Instruct-v0.3-Q5_K_M.gguf", repository: "bartowski/Mistral-7B-Instruct-v0.3-GGUF", recommended: false),
        .init(id: "llama-3.2-1b-instruct-q4_k_m", name: "Llama 3.2 1B", size: "0.8 GB", expectedSizeBytes: 847_249_408, fileName: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", repository: "bartowski/Llama-3.2-1B-Instruct-GGUF", recommended: false),
        .init(id: "llama-3.2-3b-instruct-q4_k_m", name: "Llama 3.2 3B", size: "2.0 GB", expectedSizeBytes: 2_168_958_976, fileName: "Llama-3.2-3B-Instruct-Q4_K_M.gguf", repository: "bartowski/Llama-3.2-3B-Instruct-GGUF", recommended: true),
        .init(id: "llama-3.1-8b-instruct-q4_k_m", name: "Llama 3.1 8B", size: "4.9 GB", expectedSizeBytes: 5_282_717_696, fileName: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf", repository: "bartowski/Meta-Llama-3.1-8B-Instruct-GGUF", recommended: false),
        .init(id: "gpt-oss-20b-mxfp4", name: "GPT-OSS 20B", size: "12.1 GB", expectedSizeBytes: 12_999_763_968, fileName: "gpt-oss-20b-mxfp4.gguf", repository: "ggml-org/gpt-oss-20b-GGUF", recommended: false),
        .init(id: "gemma-3-4b-it-q4_k_m", name: "Gemma 3 4B", size: "2.49 GB", expectedSizeBytes: 2_489_758_112, fileName: "google_gemma-3-4b-it-Q4_K_M.gguf", repository: "bartowski/google_gemma-3-4b-it-GGUF", recommended: true),
        .init(id: "gemma-3-1b-it-q4_k_m", name: "Gemma 3 1B", size: "0.81 GB", expectedSizeBytes: 806_058_496, fileName: "google_gemma-3-1b-it-Q4_K_M.gguf", repository: "bartowski/google_gemma-3-1b-it-GGUF", recommended: false),
    ]

    static func descriptor(id: String) -> LocalReasoningModelDescriptor? {
        models.first { $0.id == id }
    }
}
