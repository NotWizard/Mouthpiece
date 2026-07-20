import Foundation

enum DictationPhase: String, Codable, Sendable {
    case idle
    case preparing
    case recording
    case stopping
    case finalizing
    case processing
    case inserting
    case completed
    case cancelled
    case failed

    var isActive: Bool {
        switch self {
        case .preparing, .recording, .stopping, .finalizing, .processing, .inserting: true
        default: false
        }
    }
}

struct DictationSnapshot: Equatable, Sendable {
    var sessionID: UUID?
    var phase: DictationPhase
    var partialText: String
    var audioLevel: Float
    var errorMessage: String?
    var isTranslation: Bool

    static let idle = DictationSnapshot(
        sessionID: nil,
        phase: .idle,
        partialText: "",
        audioLevel: 0,
        errorMessage: nil,
        isTranslation: false
    )
}

enum DictationTransitionError: Error, Equatable {
    case invalidTransition(from: DictationPhase, to: DictationPhase)
    case staleSession
}

enum DictationSessionError: LocalizedError, Equatable {
    case noSpeech
    case maximumDurationReached

    var errorDescription: String? {
        switch self {
        case .noSpeech: "No speech was detected."
        case .maximumDurationReached: "The maximum recording duration was reached."
        }
    }
}

struct DictationStateMachine: Sendable {
    private(set) var snapshot: DictationSnapshot = .idle

    mutating func begin(sessionID: UUID, isTranslation: Bool = false) throws {
        guard !snapshot.phase.isActive else {
            throw DictationTransitionError.invalidTransition(from: snapshot.phase, to: .preparing)
        }
        snapshot = DictationSnapshot(
            sessionID: sessionID,
            phase: .preparing,
            partialText: "",
            audioLevel: 0,
            errorMessage: nil,
            isTranslation: isTranslation
        )
    }

    mutating func transition(to next: DictationPhase, sessionID: UUID) throws {
        guard snapshot.sessionID == sessionID else { throw DictationTransitionError.staleSession }
        guard Self.allowed[snapshot.phase, default: []].contains(next) else {
            throw DictationTransitionError.invalidTransition(from: snapshot.phase, to: next)
        }
        snapshot.phase = next
        if next == .completed || next == .cancelled {
            snapshot.audioLevel = 0
        }
    }

    mutating func updatePartial(_ text: String, sessionID: UUID) throws {
        guard snapshot.sessionID == sessionID else { throw DictationTransitionError.staleSession }
        guard snapshot.phase == .preparing || snapshot.phase == .recording || snapshot.phase == .stopping else {
            return
        }
        snapshot.partialText = text
    }

    mutating func updateAudioLevel(_ level: Float, sessionID: UUID) throws {
        guard snapshot.sessionID == sessionID else { throw DictationTransitionError.staleSession }
        snapshot.audioLevel = min(max(level, 0), 1)
    }

    mutating func fail(_ message: String, sessionID: UUID) throws {
        guard snapshot.sessionID == sessionID else { throw DictationTransitionError.staleSession }
        snapshot.phase = .failed
        snapshot.errorMessage = message
        snapshot.audioLevel = 0
    }

    mutating func reset() {
        snapshot = .idle
    }

    private static let allowed: [DictationPhase: Set<DictationPhase>] = [
        .preparing: [.recording, .stopping, .cancelled, .failed],
        .recording: [.stopping, .cancelled, .failed],
        .stopping: [.finalizing, .cancelled, .failed],
        .finalizing: [.processing, .inserting, .completed, .cancelled, .failed],
        .processing: [.inserting, .completed, .cancelled, .failed],
        .inserting: [.completed, .cancelled, .failed],
        .completed: [.idle, .preparing],
        .cancelled: [.idle, .preparing],
        .failed: [.idle, .preparing],
        .idle: [.preparing],
    ]
}
