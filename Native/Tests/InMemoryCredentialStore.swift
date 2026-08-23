import Foundation
@testable import Mouthpiece

// P1-15: an in-memory CredentialStore for tests. Backed by an actor so it stays
// Sendable across the Swift 6 concurrency boundary the way KeychainStore does,
// but the values live in a dictionary instead of the macOS keychain. This lets
// tests exercise coordinators that need a credential without a SecurityAgent
// prompt — the prompt is what makes DictationCoordinatorTests XCTSkip on CI /
// locked-screen environments today.
actor InMemoryCredentialStore: CredentialStore {
    private var storage: [CredentialAccount: String] = [:]

    init(seed: [CredentialAccount: String] = [:]) {
        storage = seed
    }

    func read(_ account: CredentialAccount) throws -> String? {
        storage[account]
    }

    func write(_ value: String, for account: CredentialAccount) throws {
        storage[account] = value
    }

    func delete(_ account: CredentialAccount) throws {
        storage.removeValue(forKey: account)
    }
}
