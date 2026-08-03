import Foundation

enum ObjCExceptionGuard {
    /// Runs the body, converting any Objective-C NSException into a Swift
    /// error. AVFAudio raises NSExceptions (for example when the tap format
    /// no longer matches the hardware after a device switch) that Swift
    /// do/catch cannot intercept and that would otherwise kill the process.
    static func run(_ body: () -> Void) -> NSError? {
        MPCatchObjCException(body) as NSError?
    }
}
