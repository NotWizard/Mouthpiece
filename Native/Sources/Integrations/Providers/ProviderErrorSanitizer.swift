import Foundation

// A non-2xx upstream body can be a large HTML error page or a JSON blob
// that echoes parts of the request (hotword lists, prompt fragments) plus
// internal request IDs. Surfacing it verbatim in the UI is scary, leaks
// vocabulary back to a bystander, and clutters the capsule with markup.
// This helper extracts a short, safe message the user can act on; raw
// bodies still reach the redacted debug log via LogRedactor unchanged.
enum ProviderErrorSanitizer {
    /// Maximum characters returned in a user-visible provider error.
    static let maximumLength = 300

    /// Turn a non-2xx HTTP response body into a bounded, user-safe string.
    /// Prefers the provider's own error field (`error.message`, `message`,
    /// `error`, `detail`) when present; otherwise returns a short plain-text
    /// snippet, or falls back to `HTTP <statusCode>` for HTML and oversize
    /// bodies so upstream stack traces never surface in the UI.
    static func message(from body: Data, statusCode: Int) -> String {
        if let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
            let candidates: [String?] = [
                (object["error"] as? [String: Any])?["message"] as? String,
                object["message"] as? String,
                object["error"] as? String,
                object["detail"] as? String,
            ]
            for candidate in candidates.compactMap({ $0 }) {
                let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return String(trimmed.prefix(maximumLength))
                }
            }
        }
        let text = String(decoding: body, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty, !text.hasPrefix("<"), text.count <= maximumLength { return text }
        return "HTTP \(statusCode)"
    }
}
