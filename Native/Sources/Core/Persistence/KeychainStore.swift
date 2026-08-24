import Foundation
import Security

enum KeychainError: LocalizedError {
    case unhandled(OSStatus)
    case invalidData

    var errorDescription: String? {
        switch self {
        case .unhandled(let status):
            SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error \(status)"
        case .invalidData:
            "The stored credential is not valid UTF-8."
        }
    }
}

actor KeychainStore {
    static var service: String {
        guard ProcessInfo.processInfo.environment["MOUTHPIECE_DATA_ROOT"] != nil else {
            return "com.mouthpiece.app.credentials"
        }
        return "com.mouthpiece.app.credentials.automation.\(ProcessInfo.processInfo.processIdentifier)"
    }

    // Test seam: the service name is fixed per process either way (the
    // environment and pid never change mid-run), so capturing it at init is
    // behaviorally identical while letting tests use an isolated service.
    private let service: String

    init(service: String = KeychainStore.service) {
        self.service = service
    }

    func read(_ account: CredentialAccount) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
        guard let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            throw KeychainError.invalidData
        }
        return value
    }

    func write(_ value: String, for account: CredentialAccount) throws {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account.rawValue,
        ]
        let data = Data(value.utf8)
        // No kSecAttrAccessible here: this store writes to the macOS legacy
        // file-based keychain, which silently drops that attribute and never
        // returns it. Honoring it requires kSecUseDataProtectionKeychain, and
        // that path returns errSecMissingEntitlement (-34018) without an
        // Apple-issued Team ID (see docs/audits/2026-08-21-fix-plan.md NEW-5).
        let updateStatus = SecItemUpdate(
            base as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if updateStatus == errSecItemNotFound {
            var insert = base
            insert[kSecValueData as String] = data
            let status = SecItemAdd(insert as CFDictionary, nil)
            guard status == errSecSuccess else { throw KeychainError.unhandled(status) }
        } else if updateStatus != errSecSuccess {
            throw KeychainError.unhandled(updateStatus)
        }
    }

    func delete(_ account: CredentialAccount) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account.rawValue,
        ]
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.unhandled(status)
        }
    }
}
