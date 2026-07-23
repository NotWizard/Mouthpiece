import Foundation

actor DictationCoordinator {
    private let audio: AudioCaptureService
    private let history: HistoryRepository
    private let keychain: KeychainStore
    private let logger: DebugLogStore
    private let insertion: TextInsertionService
    private let capsule: CapsuleController
    private let batchClient: BatchTranscriptionClient
    private let bailianProvider: BailianRealtimeProvider
    private let deepgramProvider: DeepgramRealtimeProvider
    private let sonioxProvider: SonioxRealtimeProvider
    private let assemblyAIProvider: AssemblyAIRealtimeProvider
    private let volcengineProvider: VolcengineRealtimeProvider
    private let localRuntime: LocalModelRuntime
    private let reasoning: ReasoningService
    private let mediaPlayback = MediaPlaybackController()
    private let onSnapshot: @MainActor @Sendable (DictationSnapshot) -> Void

    private var machine = DictationStateMachine()
    private var target: TextInsertionTarget?
    private var pcm = Data()
    private var provider: (any RealtimeTranscriptionProvider)?
    private var providerSessionID: UUID?
    private var activeSettings = AppSettings()
    private var speechGate = SpeechActivityGate()
    private var maximumDurationTask: Task<Void, Never>?
    private var preparingWatchdogTask: Task<Void, Never>?
    private var frameTask: Task<Void, Never>?
    private var reasoningTask: Task<String, Error>?

    init(
        audio: AudioCaptureService,
        history: HistoryRepository,
        keychain: KeychainStore,
        logger: DebugLogStore,
        insertion: TextInsertionService,
        capsule: CapsuleController,
        batchClient: BatchTranscriptionClient = BatchTranscriptionClient(),
        bailianProvider: BailianRealtimeProvider = BailianRealtimeProvider(),
        deepgramProvider: DeepgramRealtimeProvider = DeepgramRealtimeProvider(),
        sonioxProvider: SonioxRealtimeProvider = SonioxRealtimeProvider(),
        assemblyAIProvider: AssemblyAIRealtimeProvider = AssemblyAIRealtimeProvider(),
        volcengineProvider: VolcengineRealtimeProvider = VolcengineRealtimeProvider(),
        localRuntime: LocalModelRuntime = LocalModelRuntime(),
        reasoningService: ReasoningService? = nil,
        onSnapshot: @escaping @MainActor @Sendable (DictationSnapshot) -> Void
    ) {
        self.audio = audio
        self.history = history
        self.keychain = keychain
        self.logger = logger
        self.insertion = insertion
        self.capsule = capsule
        self.batchClient = batchClient
        self.bailianProvider = bailianProvider
        self.deepgramProvider = deepgramProvider
        self.sonioxProvider = sonioxProvider
        self.assemblyAIProvider = assemblyAIProvider
        self.volcengineProvider = volcengineProvider
        self.localRuntime = localRuntime
        self.reasoning = reasoningService ?? ReasoningService(keychain: keychain)
        self.onSnapshot = onSnapshot
    }

    func warmup(settings: AppSettings) async {
        guard settings.cloudTranscriptionProvider == "bailian",
              let key = try? await keychain.read(.bailian),
              !key.isEmpty else { return }
        let configuration = realtimeConfiguration(settings: settings, apiKey: key)
        do {
            try await bailianProvider.warmup(configuration: configuration)
            await logger.write(.debug, "Bailian realtime connection warmed")
        } catch {
            await logger.write(.warning, "Bailian warmup failed", metadata: ["error": error.localizedDescription])
        }
    }

    func shutdown() async {
        maximumDurationTask?.cancel()
        maximumDurationTask = nil
        preparingWatchdogTask?.cancel()
        preparingWatchdogTask = nil
        frameTask?.cancel()
        frameTask = nil
        reasoningTask?.cancel()
        reasoningTask = nil
        await audio.stop()
        await mediaPlayback.resumeIfPaused()
        await bailianProvider.cancel()
        await deepgramProvider.cancel()
        await sonioxProvider.cancel()
        await assemblyAIProvider.cancel()
        await volcengineProvider.cancel()
        await localRuntime.stopAll()
        provider = nil
        providerSessionID = nil
        target = nil
        pcm.removeAll(keepingCapacity: false)
        machine.reset()
        await publish()
        await capsule.hide()
    }

    func start(settings: AppSettings) async {
        guard !machine.snapshot.phase.isActive else { return }
        let sessionID = UUID()
        do {
            try machine.begin(sessionID: sessionID, isTranslation: settings.translationEnabled)
            armPreparingWatchdog(for: sessionID)
            activeSettings = settings
            speechGate = SpeechActivityGate()
            if settings.pauseOtherMediaDuringDictation {
                let paused = await mediaPlayback.pauseIfPlaying()
                if !paused {
                    await logger.write(
                        .debug,
                        "No active media session was paused",
                        sessionID: sessionID
                    )
                }
            }
            await capsule.setLanguage(settings.uiLanguage)
            pcm.removeAll(keepingCapacity: true)
            target = await insertion.captureTarget()
            await capsule.setTarget(
                processIdentifier: target?.processIdentifier,
                applicationName: target?.applicationName
            )
            await publish(show: true)
            await logger.write(.info, "Dictation session started", sessionID: sessionID)

            guard await audio.requestPermission() else { throw AudioCaptureError.permissionDenied }
            guard isCurrent(sessionID, phase: .preparing) else { return }
            // One consumer task per session instead of one unstructured Task
            // per 20ms frame (50/s, ~90k per half-hour session). The stream
            // finishes when audio tear-down releases the onFrame closure.
            let (frames, frameContinuation) = AsyncStream<Data>.makeStream(
                bufferingPolicy: .unbounded
            )
            frameTask?.cancel()
            frameTask = Task { [weak self] in
                for await frame in frames {
                    await self?.consume(frame: frame, sessionID: sessionID)
                }
            }
            try await audio.start(
                selectedDeviceUID: settings.selectedMicrophoneUID,
                onFrame: { frame in frameContinuation.yield(frame) },
                onLevel: { _ in }
            )
            guard isCurrent(sessionID, phase: .preparing) else {
                await audio.stop()
                return
            }

            if !settings.useLocalTranscription, let realtime = realtimeProvider(for: settings) {
                guard let key = try await keychain.read(realtime.account), !key.isEmpty else {
                    throw BailianRealtimeError.missingAPIKey
                }
                guard isCurrent(sessionID, phase: .preparing) else { return }
                provider = realtime.provider
                providerSessionID = sessionID
                let configuration = realtimeConfiguration(
                    settings: settings,
                    apiKey: key,
                    defaultModel: realtime.defaultModel
                )
                do {
                    try await realtime.provider.connect(configuration: configuration) { [weak self] event in
                        Task { await self?.handle(event: event, sessionID: sessionID) }
                    }
                    guard isCurrent(sessionID, phase: .preparing) else {
                        await realtime.provider.cancel()
                        return
                    }
                } catch {
                    await realtime.provider.cancel()
                    guard isCurrent(sessionID, phase: .preparing) else { return }
                    if isRealtimeOnlyProvider(settings.cloudTranscriptionProvider) {
                        throw error
                    }
                    await logger.write(
                        .warning,
                        "Realtime connection failed; retaining audio for batch fallback",
                        metadata: ["error": error.localizedDescription],
                        sessionID: sessionID
                    )
                    provider = nil
                    providerSessionID = nil
                }
            }
            try machine.transition(to: .recording, sessionID: sessionID)
            preparingWatchdogTask?.cancel()
            preparingWatchdogTask = nil
            armMaximumDuration(for: sessionID)
            await logger.write(.debug, "Dictation phase changed", metadata: ["phase": "recording"], sessionID: sessionID)
            await publish()
        } catch {
            if machine.snapshot.sessionID == sessionID, machine.snapshot.phase.isActive {
                await fail(error, sessionID: sessionID)
            }
        }
    }

    func stop() async {
        guard let sessionID = machine.snapshot.sessionID,
              machine.snapshot.phase == .recording || machine.snapshot.phase == .preparing else { return }
        do {
            maximumDurationTask?.cancel()
            maximumDurationTask = nil
            preparingWatchdogTask?.cancel()
            preparingWatchdogTask = nil
            try machine.transition(to: .stopping, sessionID: sessionID)
            await publish()
            await audio.stop()
            await mediaPlayback.resumeIfPaused()
            guard isCurrent(sessionID, phase: .stopping) else { return }
            try machine.transition(to: .finalizing, sessionID: sessionID)
            await publish()

            let recordedPCM = speechGate.trimmed(pcm)
            let capturedByteCount = pcm.count
            // Free the raw capture buffer now (about 2 MB per recorded minute);
            // keeping it alive alongside the trimmed copy and the WAV payload
            // tripled peak memory on long sessions.
            pcm.removeAll(keepingCapacity: false)
            await logger.write(
                .debug,
                "Audio capture completed",
                metadata: [
                    "bytes": String(capturedByteCount),
                    "durationMilliseconds": String(capturedByteCount * 1_000 / (AudioCaptureService.outputSampleRate * 2)),
                    "peakRMS": String(format: "%.6f", speechGate.peakRMS),
                    "speechDetected": String(speechGate.speechDetectedEver),
                ],
                sessionID: sessionID
            )

            var rawText = machine.snapshot.partialText
            if let provider, providerSessionID == sessionID {
                do {
                    let realtimeText = try await Self.finishWithTimeout(provider)
                    guard isCurrent(sessionID, phase: .finalizing) else { return }
                    if !realtimeText.isEmpty { rawText = realtimeText }
                } catch {
                    guard isCurrent(sessionID, phase: .finalizing) else { return }
                    let hasPartial = !rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    if isRealtimeOnlyProvider(activeSettings.cloudTranscriptionProvider), !hasPartial {
                        throw error
                    }
                    await logger.write(
                        .warning,
                        hasPartial
                            ? "Realtime finalize failed; using the latest partial transcript"
                            : "Realtime finalize failed; using batch fallback",
                        metadata: ["error": error.localizedDescription],
                        sessionID: sessionID
                    )
                    guard isCurrent(sessionID, phase: .finalizing) else { return }
                }
                await provider.cancel()
                self.provider = nil
                providerSessionID = nil
                guard isCurrent(sessionID, phase: .finalizing) else { return }
            }
            guard isCurrent(sessionID, phase: .finalizing) else { return }
            if rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                guard capturedByteCount > 0 else { throw AudioCaptureError.noAudioFrames }
                guard !isRealtimeOnlyProvider(activeSettings.cloudTranscriptionProvider) else {
                    throw DictationSessionError.noSpeech
                }
                rawText = try await transcribeRecordedAudio(
                    pcm16: recordedPCM,
                    settings: activeSettings,
                    sessionID: sessionID
                )
            }
            guard isCurrent(sessionID, phase: .finalizing) else { return }
            let normalizedRawText = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedRawText.isEmpty else {
                throw DictationSessionError.noSpeech
            }
            if ReasoningService.shouldCallModel(settings: activeSettings, target: target) {
                try machine.transition(to: .processing, sessionID: sessionID)
                await publish()
            }
            let finalText: String
            let reasoningService = reasoning
            let reasoningSettings = activeSettings
            let reasoningTarget = target
            let task = Task { try await reasoningService.process(normalizedRawText, settings: reasoningSettings, target: reasoningTarget) }
            reasoningTask = task
            do {
                finalText = try await task.value
                reasoningTask = nil
                guard isCurrent(sessionID, phase: .finalizing) || isCurrent(sessionID, phase: .processing) else { return }
            } catch {
                reasoningTask = nil
                guard isCurrent(sessionID, phase: .finalizing) || isCurrent(sessionID, phase: .processing) else { return }
                finalText = normalizedRawText
                await logger.write(
                    .warning,
                    "Text processing failed; using the raw transcript",
                    metadata: ["error": error.localizedDescription],
                    sessionID: sessionID
                )
                guard isCurrent(sessionID, phase: .finalizing) || isCurrent(sessionID, phase: .processing) else { return }
            }

            let completionPhase: DictationPhase
            if activeSettings.automaticallyPasteTranscription, let target {
                try machine.transition(to: .inserting, sessionID: sessionID)
                await publish()
                try await insertion.insert(finalText, into: target, settings: activeSettings)
                completionPhase = .inserting
            } else {
                completionPhase = .finalizing
            }
            guard isCurrent(sessionID, phase: completionPhase) else { return }
            if activeSettings.keepTranscriptionInClipboard {
                await insertion.copyToClipboard(finalText)
                guard isCurrent(sessionID, phase: completionPhase) else { return }
            }
            _ = try await history.save(text: finalText, rawText: normalizedRawText)
            guard isCurrent(sessionID, phase: completionPhase) else { return }
            try machine.transition(to: .completed, sessionID: sessionID)
            await logger.write(.info, "Dictation session completed", sessionID: sessionID)
            await publish()
            try? await Task.sleep(for: .milliseconds(550))
            await resetIfCurrent(sessionID)
        } catch {
            await fail(error, sessionID: sessionID)
        }
    }

    func cancel() async {
        guard let sessionID = machine.snapshot.sessionID, machine.snapshot.phase.isActive else { return }
        maximumDurationTask?.cancel()
        maximumDurationTask = nil
        preparingWatchdogTask?.cancel()
        preparingWatchdogTask = nil
        reasoningTask?.cancel()
        reasoningTask = nil
        await audio.stop()
        await mediaPlayback.resumeIfPaused()
        if providerSessionID == sessionID { await provider?.cancel() }
        do { try machine.transition(to: .cancelled, sessionID: sessionID) } catch { return }
        await logger.write(.info, "Dictation session cancelled", sessionID: sessionID)
        await publish()
        try? await Task.sleep(for: .milliseconds(250))
        await resetIfCurrent(sessionID)
    }

    func snapshot() -> DictationSnapshot { machine.snapshot }

    private func consume(frame: Data, sessionID: UUID) async {
        guard machine.snapshot.sessionID == sessionID, machine.snapshot.phase.isActive else { return }
        pcm.append(frame)
        let activity = speechGate.consume(frame)
        await consume(level: activity.visualLevel, sessionID: sessionID)
        guard providerSessionID == sessionID, let provider else { return }
        do {
            try await provider.send(pcm16: frame)
        } catch {
            self.provider = nil
            providerSessionID = nil
            await provider.cancel()
            if isRealtimeOnlyProvider(activeSettings.cloudTranscriptionProvider) {
                await fail(error, sessionID: sessionID)
                return
            }
            await logger.write(
                .warning,
                "Realtime frame send failed; retaining audio for batch fallback",
                metadata: ["error": error.localizedDescription],
                sessionID: sessionID
            )
        }
    }

    private func consume(level: Float, sessionID: UUID) async {
        guard (try? machine.updateAudioLevel(level, sessionID: sessionID)) != nil else { return }
        await capsule.updateAudioLevel(level, sessionID: sessionID)
    }

    private func handle(event: RealtimeTranscriptionEvent, sessionID: UUID) async {
        guard machine.snapshot.sessionID == sessionID else { return }
        switch event {
        case .partial(let stable, let active):
            try? machine.updatePartial(stable + active, sessionID: sessionID)
            await publish()
        case .final(let text), .sessionFinished(let text):
            try? machine.updatePartial(text, sessionID: sessionID)
            await publish()
        case .speechStarted:
            break
        case .error(let message):
            await logger.write(.warning, "Realtime provider error", metadata: ["error": message], sessionID: sessionID)
            if isRealtimeOnlyProvider(activeSettings.cloudTranscriptionProvider) {
                await fail(BailianRealtimeError.protocolError(message), sessionID: sessionID)
            }
        }
    }

    private func batchTranscribe(pcm16: Data, settings: AppSettings) async throws -> String {
        guard !isRealtimeOnlyProvider(settings.cloudTranscriptionProvider) else {
            throw BailianRealtimeError.protocolError("The selected provider only supports realtime transcription.")
        }
        let account: CredentialAccount
        switch settings.cloudTranscriptionProvider {
        case "mistral": account = .mistral
        case "groq": account = .groq
        case "deepgram": account = .deepgram
        case "soniox": account = .soniox
        case "assemblyai": account = .assemblyAI
        case "custom": account = .customTranscription
        default: account = .openAI
        }
        guard let key = try await keychain.read(account), !key.isEmpty else {
            throw BailianRealtimeError.protocolError("The selected transcription API key is missing.")
        }
        let base = batchBaseURL(settings)
        guard let endpoint = URL(string: base.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/audio/transcriptions") else {
            throw BailianRealtimeError.protocolError("The transcription endpoint is invalid.")
        }
        var configuration = BatchTranscriptionConfiguration(
            provider: settings.cloudTranscriptionProvider,
            endpoint: endpoint,
            apiKey: key,
            model: settings.cloudTranscriptionModel,
            language: settings.preferredLanguage == "auto" ? nil : settings.preferredLanguage,
            prompt: activeSettings.terminologyProfile.preferredTerms.joined(separator: ", ")
        )
        if settings.cloudTranscriptionProvider == "mistral" {
            configuration.authorizationHeader = "x-api-key"
            configuration.authorizationPrefix = ""
        }
        return try await batchClient.transcribe(
            wavData: WAVEncoder.pcm16Mono(pcm16),
            configuration: configuration
        )
    }

    private func transcribeRecordedAudio(
        pcm16: Data,
        settings: AppSettings,
        sessionID: UUID
    ) async throws -> String {
        if settings.useLocalTranscription {
            do {
                return try await localRuntime.transcribe(
                    pcm16: pcm16,
                    settings: settings,
                    prompt: terminologyPrompt(settings)
                )
            } catch {
                await logger.write(
                    .warning,
                    "Local transcription failed",
                    metadata: ["error": error.localizedDescription],
                    sessionID: sessionID
                )
                guard settings.allowCloudFallback else { throw error }
                return try await batchTranscribe(pcm16: pcm16, settings: settings)
            }
        }

        do {
            return try await batchTranscribe(pcm16: pcm16, settings: settings)
        } catch {
            guard settings.allowLocalFallback else { throw error }
            await logger.write(
                .warning,
                "Cloud transcription failed; trying local Whisper fallback",
                metadata: ["error": error.localizedDescription],
                sessionID: sessionID
            )
            var fallback = settings
            fallback.useLocalTranscription = true
            fallback.localTranscriptionProvider = .whisper
            fallback.whisperModel = settings.fallbackWhisperModel
            return try await localRuntime.transcribe(
                pcm16: pcm16,
                settings: fallback,
                prompt: terminologyPrompt(settings)
            )
        }
    }

    private func terminologyPrompt(_ settings: AppSettings) -> String? {
        let terms = settings.terminologyProfile.preferredTerms
        return terms.isEmpty ? nil : terms.joined(separator: ", ")
    }

    private func batchBaseURL(_ settings: AppSettings) -> String {
        switch settings.cloudTranscriptionProvider {
        case "groq": "https://api.groq.com/openai/v1"
        case "mistral": "https://api.mistral.ai/v1"
        case "custom": settings.cloudTranscriptionBaseURL
        default: "https://api.openai.com/v1"
        }
    }

    private func realtimeProvider(
        for settings: AppSettings
    ) -> (provider: any RealtimeTranscriptionProvider, account: CredentialAccount, defaultModel: String)? {
        switch settings.cloudTranscriptionProvider {
        case "bailian":
            (bailianProvider, .bailian, BailianRealtimeProvider.model)
        case "volcengine":
            (volcengineProvider, .volcengine, VolcengineRealtimeProvider.model)
        case "deepgram" where settings.deepgramStreamingEnabled:
            (deepgramProvider, .deepgram, "nova-3")
        case "soniox" where settings.sonioxRealtimeEnabled:
            (sonioxProvider, .soniox, "stt-rt-v4")
        case "assemblyai" where settings.assemblyAIStreaming:
            (assemblyAIProvider, .assemblyAI, "universal-streaming-multilingual")
        default:
            nil
        }
    }

    private func realtimeConfiguration(
        settings: AppSettings,
        apiKey: String,
        defaultModel: String = BailianRealtimeProvider.model
    ) -> RealtimeTranscriptionConfiguration {
        RealtimeTranscriptionConfiguration(
            apiKey: apiKey,
            model: realtimeModel(
                provider: settings.cloudTranscriptionProvider,
                configured: settings.cloudTranscriptionModel,
                fallback: defaultModel
            ),
            language: settings.preferredLanguage,
            preferredTerms: settings.terminologyProfile.preferredTerms
        )
    }

    private func realtimeModel(provider: String, configured: String, fallback: String) -> String {
        let value = configured.trimmingCharacters(in: .whitespacesAndNewlines)
        switch provider {
        case "bailian": return BailianRealtimeProvider.model
        case "volcengine": return VolcengineRealtimeProvider.model
        case "deepgram": return value.hasPrefix("nova-") ? value : fallback
        case "soniox": return value.hasPrefix("stt-rt-") ? value : fallback
        case "assemblyai": return value.hasPrefix("universal-streaming") ? value : fallback
        default: return value.isEmpty ? fallback : value
        }
    }

    private func isRealtimeOnlyProvider(_ provider: String) -> Bool {
        provider == "bailian" || provider == "volcengine"
    }

    private func fail(_ error: Error, sessionID: UUID) async {
        guard machine.snapshot.sessionID == sessionID, machine.snapshot.phase.isActive else { return }
        maximumDurationTask?.cancel()
        maximumDurationTask = nil
        preparingWatchdogTask?.cancel()
        preparingWatchdogTask = nil
        reasoningTask?.cancel()
        reasoningTask = nil
        // Lock the state machine first: the awaits below allow other queued
        // actor calls (stop, max-duration) to interleave, and once audio/media
        // were already torn down there is no way to hand the session back.
        do {
            try machine.fail(error.localizedDescription, sessionID: sessionID)
        } catch {
            return
        }
        await audio.stop()
        await mediaPlayback.resumeIfPaused()
        if providerSessionID == sessionID { await provider?.cancel() }
        await logger.write(
            .error,
            "Dictation session failed",
            metadata: ["error": error.localizedDescription],
            sessionID: sessionID
        )
        await publish()
        try? await Task.sleep(for: .seconds(2.4))
        await resetIfCurrent(sessionID)
    }

    private func resetIfCurrent(_ sessionID: UUID) async {
        guard machine.snapshot.sessionID == sessionID else { return }
        maximumDurationTask?.cancel()
        maximumDurationTask = nil
        preparingWatchdogTask?.cancel()
        preparingWatchdogTask = nil
        frameTask?.cancel()
        frameTask = nil
        reasoningTask?.cancel()
        reasoningTask = nil
        provider = nil
        providerSessionID = nil
        target = nil
        pcm.removeAll(keepingCapacity: true)
        machine.reset()
        await publish()
        await capsule.hide()
    }

    private func isCurrent(_ sessionID: UUID, phase: DictationPhase) -> Bool {
        machine.snapshot.sessionID == sessionID && machine.snapshot.phase == phase
    }

    private func armMaximumDuration(for sessionID: UUID) {
        maximumDurationTask?.cancel()
        maximumDurationTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30 * 60))
            guard !Task.isCancelled, let self else { return }
            await self.stopForMaximumDuration(sessionID)
        }
    }

    private func armPreparingWatchdog(for sessionID: UUID) {
        preparingWatchdogTask?.cancel()
        preparingWatchdogTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard !Task.isCancelled, let self else { return }
            await self.failPreparingTimeout(sessionID)
        }
    }

    private func failPreparingTimeout(_ sessionID: UUID) async {
        guard isCurrent(sessionID, phase: .preparing) else { return }
        await fail(DictationSessionError.preparingTimedOut, sessionID: sessionID)
    }

    private final class ClaimGate: @unchecked Sendable {
        private var claimed = false
        private let lock = NSLock()

        func claim() -> Bool {
            lock.lock()
            defer { lock.unlock() }
            if claimed { return false }
            claimed = true
            return true
        }
    }

    // finish() can hang forever when the socket is half-dead (send never
    // completes and ignores cancellation), which would wedge this actor and
    // freeze the capsule in finalizing. Race it against a deadline and abandon
    // the loser; a timeout falls into the existing partial/batch fallback.
    nonisolated static func finishWithTimeout(
        _ provider: any RealtimeTranscriptionProvider,
        timeout: Duration = .seconds(8)
    ) async throws -> String {
        let gate = ClaimGate()
        return try await withCheckedThrowingContinuation { continuation in
            let finishTask = Task {
                do {
                    let text = try await provider.finish()
                    if gate.claim() { continuation.resume(returning: text) }
                } catch {
                    if gate.claim() { continuation.resume(throwing: error) }
                }
            }
            Task {
                try? await Task.sleep(for: timeout)
                if gate.claim() {
                    finishTask.cancel()
                    continuation.resume(throwing: DictationSessionError.finalizeTimedOut)
                }
            }
        }
    }

    private func stopForMaximumDuration(_ sessionID: UUID) async {
        guard isCurrent(sessionID, phase: .recording) else { return }
        await logger.write(
            .warning,
            DictationSessionError.maximumDurationReached.localizedDescription,
            sessionID: sessionID
        )
        await stop()
    }

    private func publish(show: Bool = false) async {
        let snapshot = machine.snapshot
        await onSnapshot(snapshot)
        if show { await capsule.show(snapshot) } else { await capsule.update(snapshot) }
    }
}
