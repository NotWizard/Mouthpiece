import Foundation
import Sparkle

final class ArchitectureUpdateFeedDelegate: NSObject, SPUUpdaterDelegate {
    static var feedURLString: String {
        #if arch(arm64)
        let architecture = "arm64"
        #else
        let architecture = "x64"
        #endif
        return "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-\(architecture).xml"
    }

    func feedURLString(for updater: SPUUpdater) -> String? {
        Self.feedURLString
    }
}

@MainActor
final class UpdateController {
    private let feedDelegate: ArchitectureUpdateFeedDelegate?
    private let controller: SPUStandardUpdaterController?

    init(bundle: Bundle = .main) {
        guard ProcessInfo.processInfo.environment["MOUTHPIECE_DISABLE_UPDATES"] != "1" else {
            feedDelegate = nil
            controller = nil
            return
        }
        let publicKey = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        if publicKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            feedDelegate = nil
            controller = nil
        } else {
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
