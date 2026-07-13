import SwiftUI

struct OnboardingView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var step = 0

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                ForEach(0..<4, id: \.self) { index in
                    Capsule()
                        .fill(index <= step ? Color.accentColor : Color.secondary.opacity(0.2))
                        .frame(width: index == step ? 26 : 8, height: 6)
                }
            }.padding(.top, 22)

            Group {
                switch step {
                case 0: welcome
                case 1: microphone
                case 2: accessibility
                default: provider
                }
            }
            .frame(maxWidth: 540, maxHeight: .infinity)

            Divider()
            HStack {
                Button("onboarding.back") { step -= 1 }.disabled(step == 0)
                Spacer()
                if step < 3 {
                    Button("onboarding.continue") { step += 1 }.keyboardShortcut(.defaultAction)
                } else {
                    Button("onboarding.finish") { environment.completeOnboarding() }
                        .keyboardShortcut(.defaultAction)
                }
            }.padding(20)
        }
        .frame(minWidth: 760, minHeight: 560)
    }

    private var welcome: some View {
        VStack(spacing: 18) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 72)).symbolRenderingMode(.hierarchical).foregroundStyle(.tint)
            Text("onboarding.welcome.title").font(.largeTitle.weight(.semibold))
            Text("onboarding.welcome.body").font(.title3).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).frame(maxWidth: 420)
        }
    }

    private var microphone: some View {
        permissionStep(
            icon: "mic.circle.fill",
            title: "onboarding.microphone.title",
            body: "onboarding.microphone.body",
            granted: environment.permissions.microphone,
            action: environment.requestMicrophonePermission
        )
    }

    private var accessibility: some View {
        permissionStep(
            icon: "accessibility.fill",
            title: "onboarding.accessibility.title",
            body: "onboarding.accessibility.body",
            granted: environment.permissions.accessibility,
            action: environment.requestAccessibilityPermission
        )
    }

    private var provider: some View {
        VStack(alignment: .leading, spacing: 20) {
            Label("onboarding.provider.title", systemImage: "cloud")
                .font(.title.weight(.semibold))
            Text("onboarding.provider.body").font(.body).foregroundStyle(.secondary)
            Picker("speech.provider", selection: settingBinding(environment, \.cloudTranscriptionProvider)) {
                Text("Alibaba Bailian").tag("bailian")
                Text("OpenAI").tag("openai")
                Text("Deepgram").tag("deepgram")
                Text("Soniox").tag("soniox")
                Text("AssemblyAI").tag("assemblyai")
            }
            .pickerStyle(.segmented)
            .onChange(of: environment.settings.cloudTranscriptionProvider) { _, provider in
                configureProvider(provider)
            }
            CredentialEditor(account: onboardingAccount)
            if environment.settings.cloudTranscriptionProvider == "bailian" {
                Toggle("speech.bailianRealtime", isOn: settingBinding(environment, \.bailianRealtimeEnabled))
            } else if environment.settings.cloudTranscriptionProvider == "deepgram" {
                Toggle("speech.realtime", isOn: settingBinding(environment, \.deepgramStreamingEnabled))
            } else if environment.settings.cloudTranscriptionProvider == "soniox" {
                Toggle("speech.realtime", isOn: settingBinding(environment, \.sonioxRealtimeEnabled))
            } else if environment.settings.cloudTranscriptionProvider == "assemblyai" {
                Toggle("speech.realtime", isOn: settingBinding(environment, \.assemblyAIStreaming))
            }
        }.padding(36)
    }

    private var onboardingAccount: CredentialAccount {
        switch environment.settings.cloudTranscriptionProvider {
        case "bailian": .bailian
        case "deepgram": .deepgram
        case "soniox": .soniox
        case "assemblyai": .assemblyAI
        default: .openAI
        }
    }

    private func configureProvider(_ provider: String) {
        let models = [
            "bailian": "qwen3-asr-flash",
            "openai": "gpt-4o-mini-transcribe",
            "deepgram": "nova-3",
            "soniox": "stt-rt-v4",
            "assemblyai": "universal-streaming-multilingual",
        ]
        guard let model = models[provider] else { return }
        var settings = environment.settings
        settings.cloudTranscriptionModel = model
        environment.saveSettings(settings)
    }

    private func permissionStep(
        icon: String,
        title: LocalizedStringKey,
        body: LocalizedStringKey,
        granted: Bool,
        action: @escaping () -> Void
    ) -> some View {
        VStack(spacing: 18) {
            Image(systemName: icon)
                .font(.system(size: 66))
                .foregroundStyle(granted ? Color.green : Color.accentColor)
            Text(title).font(.title.weight(.semibold))
            Text(body).font(.body).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).frame(maxWidth: 420)
            if granted {
                Label("permissions.granted", systemImage: "checkmark.circle.fill").foregroundStyle(.green)
            } else {
                Button("permissions.allow", action: action).controlSize(.large)
            }
        }
    }
}
