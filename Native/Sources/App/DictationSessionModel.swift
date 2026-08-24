import Combine

// P2-6: The live dictation state — phase, partial transcript and audio
// level — used to be a `@Published` property on AppEnvironment, sitting
// next to the settings blob, the history page, the permission snapshot
// and the model-installation state. SwiftUI subscribes to an
// ObservableObject as a WHOLE (`objectWillChange`), never per property,
// so every audio-level tick published by the capture callback (~50/s
// while recording) invalidated every view holding
// `@EnvironmentObject var environment: AppEnvironment`. With the control
// panel open during dictation that re-evaluated the entire panel — the
// History list, every settings form, the sidebar — fifty times a second,
// even though not one of those views reads the dictation state.
//
// Owning the per-frame state here keeps the 50 Hz stream on a publisher
// that only the capsule/HUD side observes. AppEnvironment holds this as a
// plain `let` and NOT as `@Published`: publishing the reference would
// re-broadcast every inner change to AppEnvironment's own observers and
// defeat the split entirely.
@MainActor
final class DictationSessionModel: ObservableObject {
    @Published private(set) var snapshot: DictationSnapshot = .idle

    var phase: DictationPhase { snapshot.phase }

    func apply(_ snapshot: DictationSnapshot) {
        self.snapshot = snapshot
    }
}
