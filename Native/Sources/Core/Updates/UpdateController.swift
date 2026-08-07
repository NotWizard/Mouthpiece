import Foundation
import OSLog
import Sparkle

@MainActor
final class ArchitectureUpdateFeedDelegate: NSObject, SPUUpdaterDelegate {
    nonisolated static func feedURLString(architecture: String) -> String {
        "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-\(architecture).xml"
    }

    nonisolated static var feedURLString: String {
        #if arch(arm64)
        return feedURLString(architecture: "arm64")
        #else
        return feedURLString(architecture: "x64")
        #endif
    }

    nonisolated func feedURLString(for updater: SPUUpdater) -> String? {
        Self.feedURLString
    }
}

@MainActor
final class UpdateController {
    enum Activation: Equatable, Sendable {
        case disabledByEnvironment
        case missingPublicKey
        case enabled
    }

    // Shipping without a valid EdDSA key would let Sparkle fall back to
    // unauthenticated appcasts, so a missing key disables updates entirely.
    nonisolated static func activation(
        publicKey: String?,
        environment: [String: String]
    ) -> Activation {
        guard environment["MOUTHPIECE_DISABLE_UPDATES"] != "1" else {
            return .disabledByEnvironment
        }
        let key = (publicKey ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return key.isEmpty ? .missingPublicKey : .enabled
    }

    private let feedDelegate: ArchitectureUpdateFeedDelegate?
    private let controller: SPUStandardUpdaterController?

    init(bundle: Bundle = .main) {
        switch Self.activation(
            publicKey: bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
            environment: ProcessInfo.processInfo.environment
        ) {
        case .disabledByEnvironment:
            feedDelegate = nil
            controller = nil
        case .missingPublicKey:
            Logger(subsystem: "com.mouthpiece.app", category: "updates")
                .warning("SUPublicEDKey is missing or empty; automatic updates are disabled")
            feedDelegate = nil
            controller = nil
        case .enabled:
            let feedDelegate = ArchitectureUpdateFeedDelegate()
            self.feedDelegate = feedDelegate
            controller = SPUStandardUpdaterController(
                startingUpdater: true,
                updaterDelegate: feedDelegate,
                userDriverDelegate: nil
            )
        }
    }

    var isConfigured: Bool { controller != nil }
    var canCheckForUpdates: Bool { controller?.updater.canCheckForUpdates == true }

    func checkForUpdates() {
        controller?.checkForUpdates(nil)
    }
}
