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
        self.localRuntime = localRuntime
        self.reasoning = reasoningService ?? ReasoningService(keychain: keychain)
        self.onSnapshot = onSnapshot
    }

    func warmup(settings: AppSettings) async {
        guard settings.cloudTranscriptionProvider == "bailian",
              settings.bailianRealtimeEnabled,
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
        await audio.stop()
        await mediaPlayback.resumeIfPaused()
        await bailianProvider.cancel()
        await deepgramProvider.cancel()
        await sonioxProvider.cancel()
        await assemblyAIProvider.cancel()
        await localRuntime.stopAll()
        await reasoning.shutdown()
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
            await publish(show: true)
            await logger.write(.info, "Dictation session started", sessionID: sessionID)

            guard await audio.requestPermission() else { throw AudioCaptureError.permissionDenied }
            guard isCurrent(sessionID, phase: .preparing) else { return }
            try await audio.start(
                selectedDeviceUID: settings.selectedMicrophoneUID,
                onFrame: { [weak self] frame in
                    Task { await self?.consume(frame: frame, sessionID: sessionID) }
                },
                onLevel: { [weak self] level in
                    Task { await self?.consume(level: level, sessionID: sessionID) }
                }
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
            try machine.transition(to: .stopping, sessionID: sessionID)
            await publish()
            await audio.stop()
            await mediaPlayback.resumeIfPaused()
            guard isCurrent(sessionID, phase: .stopping) else { return }
            try machine.transition(to: .finalizing, sessionID: sessionID)
            await publish()

            guard speechGate.speechDetectedEver else {
                throw DictationSessionError.noSpeech
            }
            let recordedPCM = speechGate.trimmed(pcm)

            var rawText = machine.snapshot.partialText
            if let provider, providerSessionID == sessionID {
                do {
                    let realtimeText = try await provider.finish()
                    guard isCurrent(sessionID, phase: .finalizing) else { return }
                    if !realtimeText.isEmpty { rawText = realtimeText }
                } catch {
                    await logger.write(
                        .warning,
                        "Realtime finalize failed; using batch fallback",
                        metadata: ["error": error.localizedDescription],
                        sessionID: sessionID
                    )
                }
            }
            if rawText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                rawText = try await transcribeRecordedAudio(
                    pcm16: recordedPCM,
                    settings: activeSettings,
                    sessionID: sessionID
                )
            }
            guard isCurrent(sessionID, phase: .finalizing) else { return }
            let normalizedRawText = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalizedRawText.isEmpty else {
                throw BailianRealtimeError.protocolError("No speech was transcribed.")
            }
            let finalText: String
            do {
                finalText = try await reasoning.process(
                    normalizedRawText,
                    settings: activeSettings,
                    target: target
                )
                guard isCurrent(sessionID, phase: .finalizing) else { return }
            } catch {
                finalText = normalizedRawText
                await logger.write(
                    .warning,
                    "Text processing failed; using the raw transcript",
                    metadata: ["error": error.localizedDescription],
                    sessionID: sessionID
                )
            }

            if let target {
                try machine.transition(to: .inserting, sessionID: sessionID)
                await publish()
                try await insertion.insert(finalText, into: target, settings: activeSettings)
            }
            _ = try await history.save(text: finalText, rawText: normalizedRawText)
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
        _ = speechGate.consume(frame)
        guard providerSessionID == sessionID else { return }
        do { try await provider?.send(pcm16: frame) } catch {
            await logger.write(
                .warning,
                "Realtime frame send failed",
                metadata: ["error": error.localizedDescription],
                sessionID: sessionID
            )
        }
    }

    private func consume(level: Float, sessionID: UUID) async {
        guard (try? machine.updateAudioLevel(level, sessionID: sessionID)) != nil else { return }
        await publish()
    }

    private func handle(event: RealtimeTranscriptionEvent, sessionID: UUID) async {
        guard machine.snapshot.sessionID == sessionID else { return }
        switch event {
        case .partial(let stable, let active):
            guard speechGate.speechDetectedEver else { return }
            try? machine.updatePartial(stable + active, sessionID: sessionID)
            await publish()
        case .final(let text), .sessionFinished(let text):
            guard speechGate.speechDetectedEver else { return }
            try? machine.updatePartial(text, sessionID: sessionID)
            await publish()
        case .speechStarted:
            break
        case .error(let message):
            await logger.write(.warning, "Realtime provider error", metadata: ["error": message], sessionID: sessionID)
        }
    }

    private func batchTranscribe(pcm16: Data, settings: AppSettings) async throws -> String {
        let account: CredentialAccount
        switch settings.cloudTranscriptionProvider {
        case "bailian": account = .bailian
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
        case "bailian": "https://dashscope.aliyuncs.com/compatible-mode/v1"
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
        case "bailian" where settings.bailianRealtimeEnabled:
            (bailianProvider, .bailian, "qwen3-asr-flash-realtime")
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
        defaultModel: String = "qwen3-asr-flash-realtime"
    ) -> RealtimeTranscriptionConfiguration {
        RealtimeTranscriptionConfiguration(
            apiKey: apiKey,
            model: realtimeModel(
                provider: settings.cloudTranscriptionProvider,
                configured: settings.cloudTranscriptionModel,
                fallback: defaultModel
            ),
            language: settings.preferredLanguage
        )
    }

    private func realtimeModel(provider: String, configured: String, fallback: String) -> String {
        let value = configured.trimmingCharacters(in: .whitespacesAndNewlines)
        switch provider {
        case "bailian": return value.contains("realtime") ? value : fallback
        case "deepgram": return value.hasPrefix("nova-") ? value : fallback
        case "soniox": return value.hasPrefix("stt-rt-") ? value : fallback
        case "assemblyai": return value.hasPrefix("universal-streaming") ? value : fallback
        default: return value.isEmpty ? fallback : value
        }
    }

    private func fail(_ error: Error, sessionID: UUID) async {
        maximumDurationTask?.cancel()
        maximumDurationTask = nil
        await audio.stop()
        await mediaPlayback.resumeIfPaused()
        if providerSessionID == sessionID { await provider?.cancel() }
        try? machine.fail(error.localizedDescription, sessionID: sessionID)
        await logger.write(
            .error,
            "Dictation session failed",
            metadata: ["error": error.localizedDescription],
            sessionID: sessionID
        )
        await publish()
    }

    private func resetIfCurrent(_ sessionID: UUID) async {
        guard machine.snapshot.sessionID == sessionID else { return }
        maximumDurationTask?.cancel()
        maximumDurationTask = nil
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
