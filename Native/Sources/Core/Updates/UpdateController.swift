import Foundation
import Sparkle

@MainActor
final class UpdateController {
    private let controller: SPUStandardUpdaterController?

    init(bundle: Bundle = .main) {
        guard ProcessInfo.processInfo.environment["MOUTHPIECE_DISABLE_UPDATES"] != "1" else {
            controller = nil
            return
        }
        let publicKey = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String ?? ""
        if publicKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            controller = nil
        } else {
            controller = SPUStandardUpdaterController(
                startingUpdater: true,
                updaterDelegate: nil,
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
