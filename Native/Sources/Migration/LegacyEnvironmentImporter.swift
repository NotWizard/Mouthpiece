import Foundation

struct LegacyEnvironmentImporter: Sendable {
    static let credentialKeys: [String: CredentialAccount] = [
        "OPENAI_API_KEY": .openAI,
        "ANTHROPIC_API_KEY": .anthropic,
        "DEEPGRAM_API_KEY": .deepgram,
        "GEMINI_API_KEY": .gemini,
        "GROQ_API_KEY": .groq,
        "MISTRAL_API_KEY": .mistral,
        "SONIOX_API_KEY": .soniox,
        "BAILIAN_API_KEY": .bailian,
        "DASHSCOPE_API_KEY": .bailian,
        "ASSEMBLYAI_API_KEY": .assemblyAI,
        "CUSTOM_TRANSCRIPTION_API_KEY": .customTranscription,
        "CUSTOM_REASONING_API_KEY": .customReasoning,
    ]

    static let localStorageCredentialKeys: [String: CredentialAccount] = [
        "openaiApiKey": .openAI,
        "anthropicApiKey": .anthropic,
        "deepgramApiKey": .deepgram,
        "geminiApiKey": .gemini,
        "groqApiKey": .groq,
        "mistralApiKey": .mistral,
        "sonioxApiKey": .soniox,
        "bailianApiKey": .bailian,
        "assemblyAiApiKey": .assemblyAI,
        "customTranscriptionApiKey": .customTranscription,
        "customReasoningApiKey": .customReasoning,
    ]

    func read(url: URL) throws -> [String: String] {
        let contents = try String(contentsOf: url, encoding: .utf8)
        return parse(contents)
    }

    func parse(_ contents: String) -> [String: String] {
        var values: [String: String] = [:]
        for rawLine in contents.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, !line.hasPrefix("#") else { continue }
            let assignment = line.hasPrefix("export ") ? String(line.dropFirst(7)) : line
            guard let separator = assignment.firstIndex(of: "=") else { continue }
            let key = assignment[..<separator].trimmingCharacters(in: .whitespaces)
            guard key.range(of: #"^[A-Za-z_][A-Za-z0-9_]*$"#, options: .regularExpression) != nil else {
                continue
            }
            var value = assignment[assignment.index(after: separator)...]
                .trimmingCharacters(in: .whitespaces)
            if let quote = value.first, quote == "\"" || quote == "'",
               let close = value.dropFirst().firstIndex(of: quote) {
                // Keep only the quoted body; anything after the closing quote
                // (e.g. an inline comment) previously defeated the first/last
                // quote check and leaked literal quotes into stored API keys.
                value = String(value[value.index(after: value.startIndex)..<close])
            } else if let comment = value.firstIndex(of: "#") {
                value = value[..<comment].trimmingCharacters(in: .whitespaces)
            }
            values[key] = value
        }
        return values
    }

    func credentials(from values: [String: String]) -> [CredentialAccount: String] {
        var result: [CredentialAccount: String] = [:]
        for (key, account) in Self.credentialKeys {
            let value = values[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !value.isEmpty, result[account] == nil {
                result[account] = value
            }
        }
        for (key, account) in Self.localStorageCredentialKeys {
            let value = values[key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !value.isEmpty, result[account] == nil { result[account] = value }
        }
        return result
    }
}
