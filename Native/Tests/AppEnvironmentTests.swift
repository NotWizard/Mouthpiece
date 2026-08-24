import AppKit
import Combine
import ServiceManagement
import XCTest
@testable import Mouthpiece

@MainActor
final class AppEnvironmentTests: XCTestCase {
    func testUpdateFeedMatchesBuildArchitecture() {
        #if arch(arm64)
        XCTAssertTrue(ArchitectureUpdateFeedDelegate.feedURLString.hasSuffix("appcast-arm64.xml"))
        #else
        XCTAssertTrue(ArchitectureUpdateFeedDelegate.feedURLString.hasSuffix("appcast-x64.xml"))
        #endif
    }

    func testEnvironmentStartsReady() {
        XCTAssertTrue(AppEnvironment(bootstrap: false).isReady)
    }

    // P2-13: An activation event (menu-bar toggle click,
    // NSApplication.didBecomeActive, NSWorkspace.didWake) that fires
    // AFTER `AppEnvironment.init()` has registered its observers but
    // BEFORE the async `initialize()` finishes wiring the coordinator,
    // hotkey callbacks, and hotkey-service `swallowArmed = false`
    // resets must not mutate any state. Without the isReady guard the
    // handler would run refreshPermissions() -> updateHotkeyRegistrations(),
    // starting CGEventTap hotkeys whose HotkeyService.swallowArmed
    // still defaults to `true` — swallowing user keystrokes with no
    // handler wired — and populating `microphones` against the not-
    // yet-initialised state. The test uses the new
    // `autoMarkReady: false` init parameter to hold the environment at
    // isReady = false and asserts the deterministic invocation counter
    // stays at zero (proof the guard short-circuited BEFORE any
    // handler body executed) plus the observable state (microphones,
    // hotkey.isRunning, translationHotkey.isRunning,
    // escapeHotkey.isRunning) all stay at their construction defaults.
    func testActivationBeforeInitializeDoesNotArmSwallowing() {
        let env = AppEnvironment(bootstrap: false, autoMarkReady: false)
        XCTAssertFalse(
            env.isReady,
            "autoMarkReady=false must keep isReady=false so pre-init handler paths can be exercised"
        )
        XCTAssertEqual(env.recoverSystemIntegrationsInvocationCount, 0)
        XCTAssertTrue(env.microphones.isEmpty)
        XCTAssertFalse(env.hotkey.isRunning)
        XCTAssertFalse(env.translationHotkey.isRunning)
        XCTAssertFalse(env.escapeHotkey.isRunning)

        // Simulate the NSApplication.didBecomeActive / NSWorkspace.didWake
        // handler invocation the observers scheduled inside init() would
        // deliver during the initialize() window.
        env.recoverSystemIntegrations()

        XCTAssertFalse(
            env.isReady,
            "isReady must remain false — only initialize() may flip it"
        )
        XCTAssertEqual(
            env.recoverSystemIntegrationsInvocationCount,
            0,
            "Pre-init activation handler must short-circuit on the isReady guard"
        )
        XCTAssertTrue(
            env.microphones.isEmpty,
            "Pre-init activation handler must not enumerate microphones"
        )
        XCTAssertFalse(
            env.hotkey.isRunning,
            "Pre-init activation handler must not start the main CGEventTap"
        )
        XCTAssertFalse(
            env.translationHotkey.isRunning,
            "Pre-init activation handler must not start the translation CGEventTap (swallowArmed defaults to true)"
        )
        XCTAssertFalse(
            env.escapeHotkey.isRunning,
            "Pre-init activation handler must not start the escape CGEventTap (swallowArmed defaults to true)"
        )
    }

    func testCredentialLoadDoesNotOverwriteAnotherAccountOrNewInput() {
        XCTAssertTrue(CredentialEditor.shouldApplyLoadedCredential(
            targetAccount: .openAI,
            currentAccount: .openAI,
            valueBeforeLoad: "",
            currentValue: ""
        ))
        XCTAssertFalse(CredentialEditor.shouldApplyLoadedCredential(
            targetAccount: .openAI,
            currentAccount: .bailian,
            valueBeforeLoad: "",
            currentValue: ""
        ))
        XCTAssertFalse(CredentialEditor.shouldApplyLoadedCredential(
            targetAccount: .openAI,
            currentAccount: .openAI,
            valueBeforeLoad: "",
            currentValue: "new-key"
        ))
    }

    func testRuntimeSettingsChangesSkipUnrelatedSystemWork() {
        let original = AppSettings()
        var textEdit = original
        textEdit.reasoningModel = "custom-model"
        XCTAssertEqual(
            RuntimeSettingsChanges(previous: original, current: textEdit),
            RuntimeSettingsChanges(
                debugLogging: false,
                hotkeys: false,
                systemIntegrations: false,
                localModel: false
            )
        )

        var changed = original
        changed.debugLoggingEnabled.toggle()
        changed.dictationKey = "RightShift"
        changed.showInMenuBar.toggle()
        changed.qwenASRModel = "another-model"
        XCTAssertEqual(
            RuntimeSettingsChanges(previous: original, current: changed),
            RuntimeSettingsChanges(
                debugLogging: true,
                hotkeys: true,
                systemIntegrations: true,
                localModel: true
            )
        )
    }

    func testLaunchAtLoginActionsRespectRegisteredApprovalState() {
        XCTAssertEqual(
            LaunchAtLoginAction.resolve(enabled: true, status: .notRegistered),
            .register
        )
        XCTAssertEqual(
            LaunchAtLoginAction.resolve(enabled: true, status: .requiresApproval),
            .none
        )
        XCTAssertEqual(
            LaunchAtLoginAction.resolve(enabled: false, status: .enabled),
            .unregister
        )
        XCTAssertEqual(
            LaunchAtLoginAction.resolve(enabled: false, status: .requiresApproval),
            .unregister
        )
        XCTAssertEqual(
            LaunchAtLoginAction.resolve(enabled: false, status: .notRegistered),
            .none
        )
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

    func testTextInsertionRestoresAnOriginallyEmptyPasteboard() {
        let pasteboard = NSPasteboard.withUniqueName()
        pasteboard.clearContents()
        let snapshot = TextInsertionService.snapshot(of: pasteboard)
        XCTAssertTrue(snapshot.isEmpty)

        pasteboard.setString("temporary transcript", forType: .string)
        let changeCount = pasteboard.changeCount
        TextInsertionService.restore(
            snapshot,
            ifUnchanged: changeCount,
            expectedText: "temporary transcript",
            pasteboard: pasteboard
        )

        XCTAssertNil(pasteboard.string(forType: .string))
        XCTAssertTrue(pasteboard.pasteboardItems?.isEmpty ?? true)
    }

    func testBackToBackPastesInheritTheOriginalClipboardSnapshot() {
        let pasteboard = NSPasteboard.withUniqueName()
        pasteboard.clearContents()
        pasteboard.setString("user clipboard", forType: .string)
        let originalSnapshot = TextInsertionService.snapshot(of: pasteboard)

        // First dictation wrote its transcript; the restore has not run yet.
        pasteboard.clearContents()
        pasteboard.setString("dictation one", forType: .string)
        let inherited = TextInsertionService.snapshotForNewPaste(
            pendingItems: originalSnapshot,
            pendingChangeCount: pasteboard.changeCount,
            pendingText: "dictation one",
            pasteboard: pasteboard
        )
        XCTAssertEqual(inherited, originalSnapshot)

        // The user copied something new in between: snapshot the live board.
        pasteboard.clearContents()
        pasteboard.setString("fresh user copy", forType: .string)
        let fresh = TextInsertionService.snapshotForNewPaste(
            pendingItems: originalSnapshot,
            pendingChangeCount: pasteboard.changeCount - 1,
            pendingText: "dictation one",
            pasteboard: pasteboard
        )
        XCTAssertEqual(
            fresh.first?[.string].flatMap { String(data: $0, encoding: .utf8) },
            "fresh user copy"
        )
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
                accessibilityGranted: true,
                hotkeyConfigured: true
            ),
            .welcome
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: false,
                accessibilityGranted: true,
                hotkeyConfigured: true
            ),
            .permissions
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: true,
                accessibilityGranted: false,
                hotkeyConfigured: true
            ),
            .permissions
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: true,
                accessibilityGranted: true,
                hotkeyConfigured: false
            ),
            .hotkey
        )
        XCTAssertEqual(
            OnboardingProgress.firstIncomplete(
                welcomeSeen: true,
                microphoneGranted: true,
                accessibilityGranted: true,
                hotkeyConfigured: true
            ),
            .tryIt
        )
    }

    // P3-4: onboarding permissions step must let a privacy-conscious user proceed
    // past accessibility by pressing "Skip", but microphone remains mandatory.
    func testOnboardingCanAdvanceWhenAccessibilityDeclined() {
        // Happy path: both granted → advance.
        XCTAssertTrue(
            OnboardingProgress.canAdvancePermissions(
                microphoneGranted: true,
                accessibilityGranted: true,
                accessibilitySkipped: false
            )
        )
        // Mic granted, accessibility declined, no skip yet → still gated.
        XCTAssertFalse(
            OnboardingProgress.canAdvancePermissions(
                microphoneGranted: true,
                accessibilityGranted: false,
                accessibilitySkipped: false
            )
        )
        // Mic granted, accessibility declined but user pressed Skip → advance (P3-4 core case).
        XCTAssertTrue(
            OnboardingProgress.canAdvancePermissions(
                microphoneGranted: true,
                accessibilityGranted: false,
                accessibilitySkipped: true
            )
        )
        // Microphone stays mandatory: skipping accessibility does not unlock advance
        // when mic is still missing.
        XCTAssertFalse(
            OnboardingProgress.canAdvancePermissions(
                microphoneGranted: false,
                accessibilityGranted: false,
                accessibilitySkipped: true
            )
        )
        XCTAssertFalse(
            OnboardingProgress.canAdvancePermissions(
                microphoneGranted: false,
                accessibilityGranted: true,
                accessibilitySkipped: true
            )
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

    func testHotkeyCaptureRejectsBareKeysButAllowsFunctionKeysAndCombos() {
        // Bare character keys would swallow everyday typing system-wide.
        XCTAssertTrue(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 0, flags: []))
        XCTAssertTrue(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 49, flags: []))
        // Modified combos and F1-F19 never collide with regular typing.
        XCTAssertFalse(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 0, flags: [.command]))
        XCTAssertFalse(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 49, flags: [.shift]))
        XCTAssertFalse(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 111, flags: []))
        XCTAssertFalse(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 105, flags: []))
        XCTAssertFalse(HotkeyCapture.rejectsBareKeyDown(type: .keyDown, keyCode: 80, flags: []))
        // Modifier-only capture flows through flagsChanged untouched.
        XCTAssertFalse(HotkeyCapture.rejectsBareKeyDown(type: .flagsChanged, keyCode: 54, flags: []))

        // Captured F13/F19 events round-trip through the parser.
        for (keyCode, name): (UInt16, String) in [(105, "F13"), (80, "F19")] {
            guard let event = NSEvent.keyEvent(
                with: .keyDown,
                location: .zero,
                modifierFlags: [],
                timestamp: 0,
                windowNumber: 0,
                context: nil,
                characters: "",
                charactersIgnoringModifiers: "",
                isARepeat: false,
                keyCode: keyCode
            ) else {
                return XCTFail("Could not synthesize key event for \(name)")
            }
            XCTAssertEqual(HotkeyCapture.value(from: event), name)
            XCTAssertEqual(
                HotkeyDescriptor.parse(name),
                HotkeyDescriptor(keyCode: CGKeyCode(keyCode), modifiers: [], modifierOnly: false)
            )
        }
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

    func testCapsuleTargetWindowLocatorUsesVisibleWindowForTargetProcess() {
        func window(pid: pid_t, frame: CGRect, isOnscreen: Bool, alpha: Double = 1) -> [String: Any] {
            [
                kCGWindowLayer as String: 0,
                kCGWindowOwnerPID as String: pid,
                kCGWindowIsOnscreen as String: isOnscreen,
                kCGWindowAlpha as String: alpha,
                kCGWindowBounds as String: frame.dictionaryRepresentation,
            ]
        }

        let target = CGRect(x: 1920, y: 50, width: 900, height: 700)
        let result = CapsuleTargetWindowLocator.frame(
            processIdentifier: 42,
            windows: [
                window(pid: 7, frame: CGRect(x: 0, y: 0, width: 800, height: 600), isOnscreen: true),
                window(pid: 42, frame: CGRect(x: 0, y: 0, width: 800, height: 600), isOnscreen: false),
                window(pid: 42, frame: CGRect(x: 0, y: 0, width: 800, height: 600), isOnscreen: true, alpha: 0),
                window(pid: 42, frame: target, isOnscreen: true),
            ]
        )

        XCTAssertEqual(result, target)
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

    func testProviderSelectionDefaultsBailianToQwenAndRestoresRememberedModel() {
        XCTAssertEqual(
            CloudTranscriptionSupport.model(
                afterSelecting: "bailian",
                current: "gpt-4o-mini-transcribe"
            ),
            "qwen-audio-3.0-asr-flash-streaming"
        )
        XCTAssertEqual(
            CloudTranscriptionSupport.model(
                afterSelecting: "bailian",
                current: "my-fine-tuned-asr",
                rememberedBailianModel: "fun-asr-realtime"
            ),
            "fun-asr-realtime"
        )
        XCTAssertEqual(
            CloudTranscriptionSupport.model(
                afterSelecting: "openai",
                current: "my-fine-tuned-asr"
            ),
            "my-fine-tuned-asr"
        )
        XCTAssertEqual(CloudTranscriptionSupport.credential(for: "assemblyai"), .assemblyAI)
        XCTAssertEqual(CloudTranscriptionSupport.credential(for: "volcengine"), .volcengine)
        XCTAssertEqual(
            CloudTranscriptionSupport.model(afterSelecting: "volcengine", current: "custom-model"),
            "bigmodel"
        )
        XCTAssertEqual(CloudTranscriptionSupport.credential(for: "custom"), .customTranscription)
    }

    func testSettingsNormalizationPreservesSupportedBailianModelsAndMigratesUnknownOnes() {
        var settings = AppSettings()
        settings.cloudTranscriptionProvider = "bailian"
        settings.cloudTranscriptionModel = "fun-asr-realtime"

        settings.normalize()

        XCTAssertEqual(settings.cloudTranscriptionModel, "fun-asr-realtime")
        XCTAssertEqual(settings.bailianTranscriptionModel, "fun-asr-realtime")

        settings.cloudTranscriptionModel = "qwen3-asr-flash"
        settings.bailianTranscriptionModel = "unsupported-model"

        settings.normalize()

        XCTAssertEqual(settings.cloudTranscriptionModel, "qwen-audio-3.0-asr-flash-streaming")
        XCTAssertEqual(settings.bailianTranscriptionModel, "qwen-audio-3.0-asr-flash-streaming")
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
            ("provider-volcengine", "svg"),
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
            "onboarding.step.hotkey",
            "onboarding.step.try",
            "onboarding.try.success",
            "permissions.guide.existing",
            "capsule.success",
            "capsule.secureInputBlocked",
            "history.retentionFooter",
        ]
        XCTAssertTrue(required.isSubset(of: keySets[0]))
    }

    // P1-8: 保留策略披露必须以本地化字符串出现在所有语言，并当前锚定于
    // HistoryRepository.retentionDays / retentionMaxRows 两个常量——UI 用同一路径
    // 渲染。不做视图快照，直接断言本地化格式化后字符串仍包含实际数字。
    func testHistoryFooterStatesRetentionWindow() throws {
        let localizations = ["en", "zh-Hans", "zh-Hant"]
        let days = HistoryRepository.retentionDays
        let rows = HistoryRepository.retentionMaxRows
        for localization in localizations {
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
            let template = try XCTUnwrap(
                dictionary["history.retentionFooter"],
                "history.retentionFooter must exist in \(localization)"
            )
            let rendered = String(format: template, days, rows)
            XCTAssertTrue(
                rendered.contains("\(days)"),
                "Footer in \(localization) must mention retention days (\(days)): \(rendered)"
            )
            XCTAssertTrue(
                rendered.contains("\(rows)"),
                "Footer in \(localization) must mention row cap (\(rows)): \(rendered)"
            )
        }
    }

    // E4(4): insert() decision paths that need no live AX session.
    func testInsertBlocksSensitiveTargetsBeforeTouchingAccessibility() async {
        let service = TextInsertionService()
        var settings = AppSettings()
        settings.sensitiveAppProtectionEnabled = true
        settings.sensitiveAppBlockInsertion = true
        // The test process itself is the target, so the process-exists guard
        // passes and the sensitive-app check is the deciding branch.
        let target = TextInsertionTarget(
            processIdentifier: ProcessInfo.processInfo.processIdentifier,
            bundleIdentifier: "com.example.bitwarden",
            applicationName: "Bitwarden"
        )

        do {
            try await service.insert("secret text", into: target, settings: settings)
            XCTFail("Expected the sensitive-app guard to block insertion")
        } catch TextInsertionError.blockedSensitiveApplication(let name) {
            XCTAssertEqual(name, "Bitwarden")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testInsertFailsWhenTheTargetProcessIsGone() async {
        let service = TextInsertionService()
        let target = TextInsertionTarget(
            processIdentifier: pid_t(99_999_999),
            bundleIdentifier: "com.example.gone",
            applicationName: "Gone App"
        )

        do {
            try await service.insert("text", into: target, settings: AppSettings())
            XCTFail("Expected targetUnavailable for a dead process")
        } catch TextInsertionError.targetUnavailable {
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testAccessibilityInsertionWithoutAFocusedElementFallsThrough() async {
        // A missing focused element must reduce to .notInserted so insert()
        // continues to the next strategy instead of failing or "succeeding".
        let outcome = await TextInsertionService.insertViaAccessibility("text", on: nil)
        guard case .notInserted = outcome else {
            return XCTFail("Expected .notInserted for a missing element, got \(outcome)")
        }
    }

    // P1-4: the element captured when dictation started is not authoritative at
    // insertion time. Clicking another field in the same app leaves the captured
    // element a perfectly writable text control, so trying it first landed the
    // transcript in the field the user had LEFT. Live focus must win, with the
    // captured element kept only as a fallback for a failed live read.
    func testInsertPrefersLiveFocusedElementOverCapturedOne() async throws {
        let capturedElement = AXUIElementCreateApplication(1)
        let liveElement = AXUIElementCreateApplication(2)
        func label(_ box: TextInsertionService.AXElementBox?) -> String {
            guard let element = box?.element else { return "none" }
            if CFEqual(element, liveElement) { return "live" }
            if CFEqual(element, capturedElement) { return "captured" }
            return "other"
        }
        let service = TextInsertionService()
        let target = TextInsertionTarget(
            processIdentifier: 4242,
            bundleIdentifier: "com.example.editor",
            applicationName: "Editor",
            focusedElement: capturedElement
        )

        // The write stub accepts anything, so the recorded order alone proves
        // which field the transcript reached.
        var liveFocusWrites: [String] = []
        let insertedIntoLiveField = try await service.insertViaAccessibilityPreferringLiveFocus(
            "transcript",
            into: target,
            readFocusedElement: { _ in (liveElement, .success) },
            write: { text, box in
                XCTAssertEqual(text, "transcript")
                liveFocusWrites.append(label(box))
                return .inserted
            }
        )
        XCTAssertTrue(insertedIntoLiveField)
        XCTAssertEqual(liveFocusWrites, ["live"])

        // Fallback preserved: a failed live read (timeout, no element) still
        // reaches the captured element rather than giving up on Accessibility.
        var failedReadWrites: [String] = []
        let insertedIntoCapturedField = try await service.insertViaAccessibilityPreferringLiveFocus(
            "transcript",
            into: target,
            readFocusedElement: { _ in (nil, .cannotComplete) },
            write: { _, box in
                failedReadWrites.append(label(box))
                return box == nil ? .notInserted : .inserted
            }
        )
        XCTAssertTrue(insertedIntoCapturedField)
        XCTAssertEqual(failedReadWrites, ["none", "captured"])

        // A live element that refuses the write (GPU terminals report AXGroup)
        // must fall through to the paste path, never to the stale element.
        var refusedWrites: [String] = []
        let usedAccessibility = try await service.insertViaAccessibilityPreferringLiveFocus(
            "transcript",
            into: target,
            readFocusedElement: { _ in (liveElement, .success) },
            write: { _, box in
                refusedWrites.append(label(box))
                return .notInserted
            }
        )
        XCTAssertFalse(usedAccessibility)
        XCTAssertEqual(refusedWrites, ["live"])

        // Revoked Accessibility permission still surfaces, after the captured
        // element got its fallback attempt.
        var disabledWrites: [String] = []
        do {
            _ = try await service.insertViaAccessibilityPreferringLiveFocus(
                "transcript",
                into: target,
                readFocusedElement: { _ in (nil, .apiDisabled) },
                write: { _, box in
                    disabledWrites.append(label(box))
                    return .notInserted
                }
            )
            XCTFail("Expected .apiDisabled to map to accessibilityPermissionDenied")
        } catch TextInsertionError.accessibilityPermissionDenied {
            XCTAssertEqual(disabledWrites, ["none", "captured"])
        }
    }

    // P1-3: Secure Input makes the window server drop the synthetic Cmd+V, so
    // the paste silently no-oped and the delayed restore then wiped the
    // transcript off the clipboard as well — the dictation vanished with no
    // error. The gate must keep the transcript and report the reason instead.
    func testSecureInputActiveKeepsTranscriptOnClipboardAndThrows() {
        let pasteboard = NSPasteboard.withUniqueName()
        pasteboard.clearContents()
        pasteboard.setString("user clipboard", forType: .string)
        let service = TextInsertionService()
        service.secureInputActive = { true }

        do {
            try service.retainTranscriptIfSecureInputActive("dictated transcript", pasteboard: pasteboard)
            XCTFail("Expected the Secure Input gate to block the synthetic paste")
        } catch TextInsertionError.secureInputActive {
            // The transcript stays available for a manual ⌘V, and no restore is
            // pending that could erase it ~900 ms later.
            XCTAssertEqual(pasteboard.string(forType: .string), "dictated transcript")
            XCTAssertFalse(service.hasPendingClipboardRestore)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }

        // Inactive Secure Input must stay a no-op: the paste path keeps its own
        // snapshot/restore behaviour and the clipboard is left untouched here.
        let unblocked = TextInsertionService()
        unblocked.secureInputActive = { false }
        pasteboard.clearContents()
        pasteboard.setString("user clipboard", forType: .string)
        XCTAssertNoThrow(
            try unblocked.retainTranscriptIfSecureInputActive("dictated transcript", pasteboard: pasteboard)
        )
        XCTAssertEqual(pasteboard.string(forType: .string), "user clipboard")
        XCTAssertFalse(unblocked.hasPendingClipboardRestore)
    }

    // NEW-1: clipboard managers (Alfred/Paste/Raycast/Maccy/…) will happily
    // keep dictation content in their history unless the write carries the
    // community `org.nspasteboard.ConcealedType` marker. The paste-then-restore
    // fast path additionally carries `TransientType` so managers can ignore
    // the sub-second flash entirely. Both markers must ride EVERY transcript
    // write funnelled through the shared helper.
    func testTranscriptClipboardWriteIsMarkedConcealed() {
        let keep = NSPasteboard.withUniqueName()
        keep.writeTranscriptText("dictated transcript")
        XCTAssertEqual(keep.string(forType: .string), "dictated transcript")
        XCTAssertNotNil(keep.data(forType: NSPasteboard.concealedTranscriptType))
        // The Secure-Input / keep-in-clipboard case must NOT masquerade as
        // transient — the user pastes it manually at their own pace.
        XCTAssertNil(keep.data(forType: NSPasteboard.transientTranscriptType))

        let pasteFlash = NSPasteboard.withUniqueName()
        pasteFlash.writeTranscriptText("paste path", transient: true)
        XCTAssertEqual(pasteFlash.string(forType: .string), "paste path")
        XCTAssertNotNil(pasteFlash.data(forType: NSPasteboard.concealedTranscriptType))
        XCTAssertNotNil(pasteFlash.data(forType: NSPasteboard.transientTranscriptType))

        // A subsequent non-transient write must not inherit the previous
        // TransientType stamp: `clearContents()` inside the helper wipes it.
        pasteFlash.writeTranscriptText("kept after paste")
        XCTAssertEqual(pasteFlash.string(forType: .string), "kept after paste")
        XCTAssertNotNil(pasteFlash.data(forType: NSPasteboard.concealedTranscriptType))
        XCTAssertNil(pasteFlash.data(forType: NSPasteboard.transientTranscriptType))
    }

    func testPasteDelayAdaptsToTheTargetApplication() {
        let service = TextInsertionService()
        func target(_ bundleIdentifier: String) -> TextInsertionTarget {
            TextInsertionTarget(
                processIdentifier: 1,
                bundleIdentifier: bundleIdentifier,
                applicationName: "App"
            )
        }

        XCTAssertEqual(service.pasteDelay(for: target("com.apple.Terminal")), .milliseconds(90))
        XCTAssertEqual(service.pasteDelay(for: target("com.googlecode.iterm2")), .milliseconds(90))
        XCTAssertEqual(service.pasteDelay(for: target("com.microsoft.VSCode")), .milliseconds(220))
        XCTAssertEqual(service.pasteDelay(for: target("com.google.Chrome")), .milliseconds(220))
        XCTAssertEqual(service.pasteDelay(for: target("com.apple.TextEdit")), .milliseconds(180))
    }

    // E4(5): update feed and activation decisions.
    func testUpdateFeedSelectsTheArchitectureSpecificAppcastFile() {
        XCTAssertEqual(
            ArchitectureUpdateFeedDelegate.feedURLString(architecture: "arm64"),
            "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-arm64.xml"
        )
        XCTAssertEqual(
            ArchitectureUpdateFeedDelegate.feedURLString(architecture: "x64"),
            "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-x64.xml"
        )
        // The build-selected feed must be one of the two published feeds.
        XCTAssertTrue([
            ArchitectureUpdateFeedDelegate.feedURLString(architecture: "arm64"),
            ArchitectureUpdateFeedDelegate.feedURLString(architecture: "x64"),
        ].contains(ArchitectureUpdateFeedDelegate.feedURLString))
    }

    // P2-9: appcast selection must key off the HOST architecture, not the
    // build architecture. Prior to the fix `#if arch(arm64)` locked an x86_64
    // build under Rosetta 2 on Apple Silicon to appcast-x64.xml forever, so
    // the user was stranded on the translated slice with no notice. The pure
    // seam below is what release code composes with sysctl (`hw.optional.arm64`
    // and `sysctl.proc_translated`) — either signal flips the input to true.
    func testUpdateFeedURLPrefersARM64WhenHostSupports() {
        XCTAssertEqual(
            ArchitectureUpdateFeedDelegate.feedURLString(hostSupportsARM64: true),
            "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-arm64.xml"
        )
        XCTAssertEqual(
            ArchitectureUpdateFeedDelegate.feedURLString(hostSupportsARM64: false),
            "https://github.com/NotWizard/Mouthpiece/releases/latest/download/appcast-x64.xml"
        )
    }

    func testUpdateActivationRequiresAPublicKeyAndHonorsTheKillSwitch() {
        XCTAssertEqual(
            UpdateController.activation(
                publicKey: "xRChY2RK",
                environment: ["MOUTHPIECE_DISABLE_UPDATES": "1"]
            ),
            .disabledByEnvironment
        )
        XCTAssertEqual(
            UpdateController.activation(publicKey: nil, environment: [:]),
            .missingPublicKey
        )
        XCTAssertEqual(
            UpdateController.activation(publicKey: "  \n", environment: [:]),
            .missingPublicKey
        )
        XCTAssertEqual(
            UpdateController.activation(publicKey: "xRChY2RK", environment: [:]),
            .enabled
        )
        XCTAssertEqual(
            UpdateController.activation(
                publicKey: "xRChY2RK",
                environment: ["MOUTHPIECE_DISABLE_UPDATES": "0"]
            ),
            .enabled
        )
    }

    func testUpdateControllerStaysUnconfiguredWithoutAPublicKey() throws {
        final class KeylessBundle: Bundle {
            override func object(forInfoDictionaryKey key: String) -> Any? { nil }
        }

        // NSBundle caches instances per path (Bundle.main's path would return
        // the cached real bundle), so use a fresh directory with no Info.plist.
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Mouthpiece-KeylessBundle-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }

        let bundle = try XCTUnwrap(KeylessBundle(path: directory.path))
        XCTAssertNil(bundle.object(forInfoDictionaryKey: "SUPublicEDKey"))
        let controller = UpdateController(bundle: bundle)
        XCTAssertFalse(controller.isConfigured)
        XCTAssertFalse(controller.canCheckForUpdates)
        // Must be a safe no-op instead of crashing on a nil updater.
        controller.checkForUpdates()
    }

    // P2-21: Fire-and-forget `Task { ... }` closures on the long-lived
    // AppEnvironment used to strongly capture `self` and could outlive
    // `shutdown()`, pinning the environment alive with a queued
    // history-load / delete / restore / model-status check / clipboard-
    // hotkey callback in flight. Every such site now captures
    // `[weak self]` (or `[logger]` / `[permissionsService]` /
    // `[modelInstaller]`), so dropping the last strong reference at
    // scope exit deallocates the environment whether or not those
    // queued Task bodies have run yet.
    func testShutdownCancelsFireAndForgetTasks() async {
        weak var weakEnv: AppEnvironment?
        do {
            let env = AppEnvironment(bootstrap: false)
            weakEnv = env
            // Every public method below funnels through a
            // `Task { ... }`; in `bootstrap: false` several of them
            // short-circuit before Task creation (missing history /
            // coordinator), but `refreshHistory`, `clearHistory`,
            // `deleteTranscription`, `restoreTranscription`, and
            // `refreshLocalModelStatus` each unconditionally spawn one
            // — sufficient to demonstrate the invariant.
            env.refreshHistory()
            env.loadMoreHistory()
            env.clearHistory()
            env.deleteTranscription(1)
            env.restoreTranscription(TranscriptionRecord(
                id: 1, text: "restored", rawText: nil, timestamp: .now
            ))
            env.stopDictation()
            env.cancelDictation()
            env.refreshLocalModelStatus()
            await env.shutdown()
        }
        // DO NOT yield the MainActor between shutdown and this
        // assertion. Yielding would let each queued fire-and-forget
        // Task body run to its guard-short-circuit exit and drop the
        // strong `self` even in the un-fixed baseline. Keeping the
        // MainActor exclusive from `env.shutdown()` through the
        // assertion pins the exact invariant the fix restores: with
        // `[weak self]` on every fire-and-forget Task, dropping the
        // last strong reference at scope exit deallocates the
        // AppEnvironment regardless of whether the queued Task bodies
        // have executed yet (audit P2-21).
        XCTAssertNil(
            weakEnv,
            "Fire-and-forget Task closures on AppEnvironment must capture self weakly so shutdown() plus scope exit deallocate the environment even before queued Task bodies drain (audit P2-21)"
        )
    }

    // P2-7: `startupError` (fatal init diagnostic; persistent alert/banner)
    // and `operationError` (recoverable runtime failure; auto-dismissing
    // toast) are now separate channels. On HEAD every transient failure —
    // a failed history delete, a rejected credential save, a launch-at-login
    // registration error, a hotkey re-registration after a permission
    // refresh — assigned `startupError` directly, so the last writer won:
    // either the transient message erased the fatal diagnostic the user
    // still needed, or the fatal one occupied the only slot and the
    // operation failure was never shown. Both writers here are the real
    // production entry points (`reportStartupFailure` is called by init()'s
    // corrupted-store branch and initialize()'s catch; `report` is what all
    // eleven rerouted runtime sites call), so this pins the split itself.
    func testOperationErrorDoesNotOverwriteStartupError() {
        struct TransientFailure: LocalizedError {
            var errorDescription: String? { "History record could not be deleted" }
        }

        let env = AppEnvironment(bootstrap: false)
        let fatal = SettingsRepositoryError.corruptedStore.localizedDescription
        env.reportStartupFailure(fatal)
        XCTAssertEqual(env.startupError, fatal)
        XCTAssertNil(env.operationError, "A fatal startup failure must not populate the transient channel")

        env.report(TransientFailure())

        XCTAssertEqual(
            env.startupError, fatal,
            "A transient operation failure must not overwrite the fatal startup diagnostic (audit P2-7)"
        )
        XCTAssertEqual(
            env.operationError, "History record could not be deleted",
            "A transient operation failure must surface on its own channel even while a startup error is pending (audit P2-7)"
        )

        // Dismissal is per-channel: auto-dismissing the toast must leave the
        // persistent startup diagnostic on screen, and vice versa.
        env.dismissOperationError()
        XCTAssertNil(env.operationError)
        XCTAssertEqual(env.startupError, fatal)

        env.report(TransientFailure())
        env.dismissStartupError()
        XCTAssertNil(env.startupError)
        XCTAssertEqual(env.operationError, "History record could not be deleted")
    }

    // P2-14: `initialize()` ran `isReady = true` on BOTH tails, so an init
    // that threw — a non-writable Application Support directory, a SQLite
    // open failure, a corrupted history file — still advertised a fully
    // live app while `coordinator` stayed nil. Every dictation entry point
    // then hit `guard let coordinator else { return }`: the hotkey did
    // nothing, the menu item did nothing, and the user got no explanation
    // and no way to retry short of relaunching. The failure tail now keeps
    // the app at `isReady = false` with the reason attached, which also
    // means P2-13's `isReady` guards keep the lifecycle handlers off a
    // half-initialised environment, and `retryInitialize()` re-runs the
    // very same initialization path. `reportInitializationFailure` is the
    // real production writer (initialize()'s catch calls exactly it), so
    // seeding through it pins the shipped behaviour rather than a test-only
    // shortcut — the same rationale as P2-7's `reportStartupFailure`.
    func testFailedInitReportsDegradedAndAllowsRetry() async {
        struct InitializationFailure: LocalizedError {
            var errorDescription: String? { "Application Support could not be prepared" }
        }

        let env = AppEnvironment(bootstrap: false)
        XCTAssertTrue(env.isReady)
        XCTAssertNil(env.degradedReason)
        let attemptsBeforeRetry = env.initializeAttemptCount

        env.reportInitializationFailure(InitializationFailure())

        XCTAssertFalse(
            env.isReady,
            "A failed initialize() must not report the app as ready — the coordinator is nil (audit P2-14)"
        )
        XCTAssertEqual(
            env.degradedReason, "Application Support could not be prepared",
            "The degraded state must carry the reason so the panel can explain the failure (audit P2-14)"
        )
        XCTAssertEqual(
            env.startupError, "Application Support could not be prepared",
            "The degraded state must still write the fatal channel so the existing banner fires (audit P2-7)"
        )

        // Because the degraded state holds isReady = false, P2-13's guards
        // keep the lifecycle handlers away from the nil coordinator too.
        env.recoverSystemIntegrations()
        XCTAssertEqual(
            env.recoverSystemIntegrationsInvocationCount, 0,
            "Lifecycle handlers must stay short-circuited while degraded (audit P2-13 + P2-14)"
        )

        env.retryInitialize()

        XCTAssertNil(
            env.degradedReason,
            "retryInitialize() must clear the degraded banner at the start of the new attempt (audit P2-14)"
        )
        XCTAssertNil(env.startupError, "The stale fatal diagnostic must not outlive the retry")
        XCTAssertEqual(
            env.initializeAttemptCount, attemptsBeforeRetry + 1,
            "retryInitialize() must actually re-attempt initialization, not just clear the banner (audit P2-14)"
        )

        // A second Retry click while the attempt is in flight must not stack
        // a competing initialization over the same coordinator/history slots.
        env.retryInitialize()
        XCTAssertEqual(
            env.initializeAttemptCount, attemptsBeforeRetry + 1,
            "Concurrent retries must collapse onto the in-flight attempt (audit P2-14)"
        )

        // Cancel the queued retry before its body can touch the host's
        // Application Support directory, login items, or event taps:
        // shutdown() cancels the initialization task, whose first
        // `ensureInitializationCanContinue()` then throws immediately.
        await env.shutdown()
    }

    // P2-6: The live dictation state (phase / partial transcript / audio
    // level) used to be `@Published` on AppEnvironment next to the settings
    // blob, the history page and the permission snapshot. SwiftUI subscribes
    // to an ObservableObject as a whole — never per property — so every
    // audio-level tick (~50/s while recording) invalidated each view holding
    // `@EnvironmentObject var environment: AppEnvironment`: with the control
    // panel open during dictation the whole panel (History list, settings
    // forms, sidebar) re-evaluated its `body` fifty times a second, though
    // none of those views reads the dictation state. The per-frame state now
    // lives on `DictationSessionModel`, held as a plain `let` (see that
    // file's header for why publishing the reference would undo the split).
    // Pinned structurally instead of by sampling a frame rate: the
    // environment's publisher must stay silent across a second of frames.
    func testDictationLevelUpdatesDoNotNotifyEnvironmentObservers() {
        let env = AppEnvironment(bootstrap: false)
        var environmentNotifications = 0
        var sessionNotifications = 0
        let environmentSubscription = env.objectWillChange.sink { _ in environmentNotifications += 1 }
        let sessionSubscription = env.session.objectWillChange.sink { _ in sessionNotifications += 1 }
        defer {
            environmentSubscription.cancel()
            sessionSubscription.cancel()
        }

        // Replay one second of the real stream. `DictationCoordinator`
        // publishes a whole snapshot per frame, so the level and the partial
        // transcript both move on every tick — exactly the traffic that used
        // to reach the control panel.
        let sessionID = UUID()
        let frames = 50
        for frame in 0..<frames {
            env.session.apply(DictationSnapshot(
                sessionID: sessionID,
                phase: .recording,
                partialText: String(repeating: "word ", count: frame),
                audioLevel: Float(frame % 10) / 10,
                errorMessage: nil,
                isTranslation: false
            ))
        }

        XCTAssertEqual(
            sessionNotifications, frames,
            "The capsule/HUD side must still get every per-frame update — live level and partial text cannot lose responsiveness (audit P2-6)"
        )
        XCTAssertEqual(
            environmentNotifications, 0,
            "Per-frame dictation updates must not notify AppEnvironment's observers, or the whole control panel re-renders at ~50 Hz while dictating (audit P2-6)"
        )
        XCTAssertEqual(env.session.phase, .recording, "The environment must still see the live phase for its hotkey and shutdown decisions")
        XCTAssertEqual(
            env.session.snapshot.partialText, String(repeating: "word ", count: frames - 1),
            "The extracted model must hold the newest snapshot, not a stale copy"
        )

        // Control: the environment's own low-frequency channel still notifies
        // its observers, so the zero above is the split at work and not a
        // dead publisher. `reportStartupFailure` is a real production writer.
        env.reportStartupFailure("fatal")
        XCTAssertEqual(
            environmentNotifications, 1,
            "Low-frequency environment state must still publish to the panel (audit P2-6)"
        )
    }
}
