import Darwin
import Foundation
import OSLog
import Sparkle

@MainActor
final class ArchitectureUpdateFeedDelegate: NSObject, SPUUpdaterDelegate {
    nonisolated static func feedURLString(architecture: String) -> String {
        "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-\(architecture).xml"
    }

    // P2-9: choose the appcast by HOST architecture at runtime, not by the
    // build architecture. An x86_64 build running on Apple Silicon under
    // Rosetta 2 previously fetched appcast-x64.xml forever and stranded users
    // on the translated slice with no notice; the seam below is exercised by
    // the unit test that pins both branches to their published feeds.
    nonisolated static func feedURLString(hostSupportsARM64: Bool) -> String {
        feedURLString(architecture: hostSupportsARM64 ? "arm64" : "x64")
    }

    // Two independent sysctl signals both mean "the CPU is arm64-capable":
    //   1. `hw.optional.arm64` == 1 on any Apple Silicon host (native or
    //      translated processes both see it).
    //   2. `sysctl.proc_translated` == 1 when THIS process is being translated
    //      by Rosetta 2, which is only possible on an arm64 host.
    // Either signal is sufficient, so a stranded x86_64 binary still migrates
    // to the arm64 appcast; on real Intel Macs both return 0 or ENOENT and we
    // fall back to the x64 appcast.
    nonisolated static func hostSupportsARM64() -> Bool {
        if sysctlFlag("hw.optional.arm64") == 1 { return true }
        if sysctlFlag("sysctl.proc_translated") == 1 { return true }
        return false
    }

    private nonisolated static func sysctlFlag(_ name: String) -> Int32? {
        var value: Int32 = 0
        var size = MemoryLayout<Int32>.size
        guard sysctlbyname(name, &value, &size, nil, 0) == 0 else { return nil }
        return value
    }

    nonisolated static var feedURLString: String {
        feedURLString(hostSupportsARM64: hostSupportsARM64())
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
