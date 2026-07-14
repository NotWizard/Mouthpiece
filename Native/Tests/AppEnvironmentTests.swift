import XCTest
@testable import Mouthpiece

@MainActor
final class AppEnvironmentTests: XCTestCase {
    func testEnvironmentStartsReady() {
        XCTAssertTrue(AppEnvironment(bootstrap: false).isReady)
    }

    func testControlPanelNavigationRestoresKnownSectionAndFallsBackToUsage() {
        XCTAssertEqual(ControlPanelSection.resolve("history"), .history)
        XCTAssertEqual(ControlPanelSection.resolve("unknown"), .usage)
        XCTAssertEqual(
            ControlPanelSection.allCases,
            [.usage, .dictation, .processing, .vocabulary, .history, .privacy]
        )
    }

    func testOnboardingFindsFirstIncompleteRequiredStep() {
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: false,
                microphoneGranted: true,
                serviceReady: true
            ),
            .welcome
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: false,
                serviceReady: true
            ),
            .permissions
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: true,
                serviceReady: false
            ),
            .service
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: true,
                serviceReady: true
            ),
            .tryIt
        )
    }

    func testHotkeyCaptureDetectsConflictsAndEscape() {
        XCTAssertTrue(HotkeyCapture.conflicts("Command+K", " command + k "))
        XCTAssertFalse(HotkeyCapture.conflicts("RightCommand", "Command+K"))
        XCTAssertFalse(HotkeyCapture.conflicts("RightCommand", ""))
        XCTAssertTrue(HotkeyCapture.isCancelKeyCode(53))
        XCTAssertFalse(HotkeyCapture.isCancelKeyCode(49))
        XCTAssertEqual(
            HotkeyCapture.displayName(for: "RightCommand", language: .english),
            "Right Command"
        )
    }

    func testProviderSelectionPreservesCustomModelAndUpdatesKnownDefault() {
        XCTAssertEqual(
            CloudTranscriptionSupport.model(
                afterSelecting: "bailian",
                current: "gpt-4o-mini-transcribe"
            ),
            "qwen3-asr-flash"
        )
        XCTAssertEqual(
            CloudTranscriptionSupport.model(
                afterSelecting: "bailian",
                current: "my-fine-tuned-asr"
            ),
            "my-fine-tuned-asr"
        )
        XCTAssertEqual(CloudTranscriptionSupport.credential(for: "assemblyai"), .assemblyAI)
        XCTAssertEqual(CloudTranscriptionSupport.credential(for: "custom"), .customTranscription)
    }

    func testReasoningProviderDefaultsDoNotOverwriteCustomConfiguration() {
        let known = ReasoningProviderSupport.configuration(
            for: "bailian",
            currentModel: "gpt-4o-mini",
            currentBaseURL: "https://api.openai.com/v1"
        )
        XCTAssertEqual(known.model, "qwen-flash")
        XCTAssertEqual(known.baseURL, "https://dashscope.aliyuncs.com/compatible-mode/v1")

        let custom = ReasoningProviderSupport.configuration(
            for: "bailian",
            currentModel: "my-fine-tuned-model",
            currentBaseURL: "https://example.com/v1"
        )
        XCTAssertEqual(custom.model, "my-fine-tuned-model")
        XCTAssertEqual(custom.baseURL, "https://example.com/v1")
    }

    func testHistorySearchMatchesFinalAndRawTextWithinDateFilter() {
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let recent = TranscriptionRecord(
            id: 1,
            text: "Final transcript",
            rawText: "Original recording",
            timestamp: now.addingTimeInterval(-3_600)
        )
        let old = TranscriptionRecord(
            id: 2,
            text: "Final transcript",
            rawText: nil,
            timestamp: now.addingTimeInterval(-10 * 86_400)
        )

        XCTAssertTrue(HistorySearch.matches(recent, query: "final", dateFilter: .week, now: now))
        XCTAssertTrue(HistorySearch.matches(recent, query: "recording", dateFilter: .week, now: now))
        XCTAssertFalse(HistorySearch.matches(recent, query: "missing", dateFilter: .all, now: now))
        XCTAssertFalse(HistorySearch.matches(old, query: "", dateFilter: .week, now: now))
    }

    func testRedesignLocalizationKeysMatchAcrossAllLanguages() throws {
        let localizations = ["en", "zh-Hans", "zh-Hant"]
        let keySets = try localizations.map { localization -> Set<String> in
            let url = try XCTUnwrap(
                Bundle.main.url(
                    forResource: "Localizable",
                    withExtension: "strings",
                    subdirectory: nil,
                    localization: localization
                )
            )
            let data = try Data(contentsOf: url)
            let dictionary = try XCTUnwrap(
                PropertyListSerialization.propertyList(from: data, format: nil) as? [String: String]
            )
            return Set(dictionary.keys)
        }

        XCTAssertEqual(keySets[0], keySets[1])
        XCTAssertEqual(keySets[0], keySets[2])

        let required: Set<String> = [
            "sidebar.general",
            "sidebar.speechRecognition",
            "sidebar.textProcessing",
            "sidebar.personalization",
            "sidebar.history",
            "sidebar.privacy",
            "history.search",
            "history.clear.confirmTitle",
            "processing.hotkeyConflict",
            "provider.custom",
            "privacy.dataProcessing",
            "privacy.audioPath",
            "privacy.textPath",
            "promptStudio.discard.title",
            "onboarding.step.welcome",
            "onboarding.step.permissions",
            "onboarding.step.service",
            "onboarding.step.try",
            "onboarding.try.success",
        ]
        XCTAssertTrue(required.isSubset(of: keySets[0]))
    }
}
