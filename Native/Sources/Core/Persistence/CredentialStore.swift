import Foundation

// P1-15 (CI blindness): DictationCoordinator and ReasoningService only need to
// read/write a per-provider credential; they do not care whether the bytes live
// in the macOS keychain, in memory, or anywhere else. Widening the seam from a
// concrete KeychainStore to this protocol lets unit tests inject an in-memory
// implementation, so their harness stops hanging on the SecurityAgent prompt
// on locked-screen dev boxes and on CI runners (where the prompt cannot appear
// and the tests silently XCTSkip). KeychainStore stays the production default.
protocol CredentialStore: Sendable {
    func read(_ account: CredentialAccount) async throws -> String?
    func write(_ value: String, for account: CredentialAccount) async throws
    func delete(_ account: CredentialAccount) async throws
}

extension KeychainStore: CredentialStore {}
