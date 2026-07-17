import AppKit
import XCTest
@testable import Mouthpiece

@MainActor
final class AppEnvironmentTests: XCTestCase {
    func testEnvironmentStartsReady() {
        XCTAssertTrue(AppEnvironment(bootstrap: false).isReady)
    }

    func testTextInsertionNeverTargetsAnotherMouthpieceProcess() {
        XCTAssertFalse(TextInsertionService.isExternalApplication(
            processIdentifier: 202,
            bundleIdentifier: "com.mouthpiece.app",
            currentProcessIdentifier: 101,
            currentBundleIdentifier: "com.mouthpiece.app",
            isTerminated: false
        ))
        XCTAssertTrue(TextInsertionService.isExternalApplication(
            processIdentifier: 202,
            bundleIdentifier: "com.apple.TextEdit",
            currentProcessIdentifier: 101,
            currentBundleIdentifier: "com.mouthpiece.app",
            isTerminated: false
        ))
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
        XCTAssertFalse(HotkeyCapture.completesCapture(for: .flagsChanged))
        XCTAssertTrue(HotkeyCapture.completesCapture(for: .keyDown))
        XCTAssertEqual(
            HotkeyCapture.displayName(for: "RightCommand", language: .english),
            "Right Command"
        )
        XCTAssertEqual(
            HotkeyCapture.displayName(for: "RightShift", language: .english),
            "Right Shift"
        )
        XCTAssertTrue(AppEnvironment.shouldCancelForEscape(keyCode: 53, enabled: true, isActive: true))
        XCTAssertFalse(AppEnvironment.shouldCancelForEscape(keyCode: 53, enabled: false, isActive: true))
        XCTAssertFalse(AppEnvironment.shouldCancelForEscape(keyCode: 49, enabled: true, isActive: true))
        XCTAssertEqual(
            HotkeyDescriptor.parse("Escape"),
            HotkeyDescriptor(keyCode: 53, modifiers: [], modifierOnly: false)
        )
    }

    func testSystemSettingsWindowLocatorIgnoresHiddenWindows() {
        func window(pid: pid_t, frame: CGRect, isOnscreen: Bool) -> [String: Any] {
            [
                kCGWindowLayer as String: 0,
                kCGWindowOwnerPID as String: pid,
                kCGWindowIsOnscreen as String: isOnscreen,
                kCGWindowBounds as String: frame.dictionaryRepresentation,
            ]
        }

        let hidden = CGRect(x: 10, y: 10, width: 900, height: 700)
        let visible = CGRect(x: 1920, y: 40, width: 820, height: 640)
        let result = SystemSettingsWindowLocator.frame(
            from: [
                window(pid: 1, frame: hidden, isOnscreen: false),
                window(pid: 2, frame: visible, isOnscreen: true),
            ],
            bundleIdentifierForPID: { pid in
                pid == 1 || pid == 2 ? "com.apple.systempreferences" : nil
            }
        )

        XCTAssertEqual(result, visible)
    }

    func testTranslationHotkeyCombinesModifierOnlyDictationWithSuffix() {
        XCTAssertEqual(
            TranslationHotkey.combination(dictationKey: "RightCommand", suffix: ","),
            "Command+,"
        )
        XCTAssertEqual(
            TranslationHotkey.combination(dictationKey: "RightShift", suffix: "Space"),
            "Shift+Space"
        )
        XCTAssertNil(
            TranslationHotkey.combination(dictationKey: "Command+K", suffix: ",")
        )
        XCTAssertEqual(TranslationHotkey.suffix(from: "Command+."), ".")
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

    func testProviderIconAssetsHaveNativeDisplaySize() throws {
        let assets = [
            ("provider-openai", "svg"),
            ("provider-alibaba-cloud", "svg"),
            ("provider-anthropic", "svg"),
            ("provider-gemini", "svg"),
            ("provider-groq", "svg"),
            ("provider-deepgram", "svg"),
            ("provider-soniox", "png"),
            ("provider-assemblyai", "png"),
            ("provider-mistral", "png"),
        ]

        for (assetName, assetExtension) in assets {
            let url = try XCTUnwrap(Bundle.main.url(forResource: assetName, withExtension: assetExtension))
            let image = try XCTUnwrap(NSImage(contentsOf: url))
            XCTAssertGreaterThanOrEqual(image.size.width, 18, assetName)
            XCTAssertGreaterThanOrEqual(image.size.height, 18, assetName)
        }

        let markURL = try XCTUnwrap(Bundle.main.url(forResource: "mouthpiece-mark", withExtension: "svg"))
        let mark = try XCTUnwrap(NSImage(contentsOf: markURL))
        XCTAssertGreaterThanOrEqual(mark.size.width, 18)
        XCTAssertGreaterThanOrEqual(mark.size.height, 18)
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
            "history.processedText",
            "history.originalText",
            "history.copyProcessed",
            "history.copyOriginal",
            "history.originalUnavailable",
            "processing.hotkeyConflict",
            "provider.custom",
            "privacy.diagnostics",
            "privacy.debugLogging",
            "privacy.updates",
            "privacy.checkForUpdates",
            "privacy.about",
            "privacy.version",
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
