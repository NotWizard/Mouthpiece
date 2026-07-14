import AppKit
import SwiftUI

struct PrivacyDiagnosticsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "privacy.title", subtitle: "privacy.subtitle") {
            SettingsSection(title: "privacy.dataProcessing") {
                SettingsRow(
                    icon: "waveform",
                    title: "privacy.audioPath",
                    detail: "privacy.audioPath.detail"
                ) {
                    Text(audioDestination)
                        .foregroundStyle(.secondary)
                }
                SettingsRow(
                    icon: "text.bubble",
                    title: "privacy.textPath",
                    detail: "privacy.textPath.detail",
                    showsDivider: false
                ) {
                    Text(textDestination)
                        .foregroundStyle(.secondary)
                }
            }

            SettingsSection(title: "privacy.sensitiveApps") {
                SettingsRow(
                    icon: "hand.raised",
                    title: "privacy.protection",
                    detail: "privacy.protection.detail",
                    showsDivider: environment.settings.sensitiveAppProtectionEnabled
                ) {
                    Toggle("", isOn: settingBinding(environment, \.sensitiveAppProtectionEnabled))
                        .labelsHidden()
                }
                if environment.settings.sensitiveAppProtectionEnabled {
                    SettingsRow(icon: "text.badge.xmark", title: "privacy.blockInsertion") {
                        Toggle("", isOn: settingBinding(environment, \.sensitiveAppBlockInsertion))
                            .labelsHidden()
                    }
                    SettingsRow(icon: "cloud", title: "privacy.allowCloudReasoning") {
                        Toggle("", isOn: settingBinding(environment, \.allowSensitiveAppCloudReasoning))
                            .labelsHidden()
                    }
                    SettingsRow(icon: "clipboard", title: "privacy.allowPasteMonitoring", showsDivider: false) {
                        Toggle("", isOn: settingBinding(environment, \.allowSensitiveAppPasteMonitoring))
                            .labelsHidden()
                    }
                }
            }

            SettingsSection(title: "privacy.diagnostics") {
                SettingsRow(icon: "ladybug", title: "privacy.debugLogging", detail: "privacy.debugRetention") {
                    Toggle("", isOn: settingBinding(environment, \.debugLoggingEnabled))
                        .labelsHidden()
                }
                SettingsRow(icon: "folder", title: "privacy.openLogs", showsDivider: false) {
                    Button("privacy.open") {
                        NSWorkspace.shared.open(AppPaths.logsDirectory)
                    }
                }
            }

            SettingsSection(title: "privacy.updates") {
                SettingsRow(icon: "arrow.triangle.2.circlepath", title: "privacy.checkForUpdates", showsDivider: false) {
                    HStack(spacing: 8) {
                        if !environment.updates.isConfigured {
                            InlineStatus("privacy.updatesUnavailable", kind: .neutral)
                        }
                        Button("privacy.checkNow") {
                            environment.checkForUpdates()
                        }
                        .disabled(!environment.updates.isConfigured)
                    }
                }
            }

            SettingsSection(title: "privacy.about") {
                SettingsRow(icon: "info.circle", title: "privacy.version") {
                    Text(version)
                        .foregroundStyle(.secondary)
                }
                SettingsRow(icon: "hammer", title: "privacy.build", showsDivider: false) {
                    Text(build)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "2.0.0"
    }

    private var build: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "20000"
    }

    private var audioDestination: String {
        if environment.settings.useLocalTranscription {
            return AppLocalization.string("privacy.onDevice", language: environment.settings.uiLanguage)
        }
        return CloudTranscriptionSupport.displayName(
            for: environment.settings.cloudTranscriptionProvider,
            language: environment.settings.uiLanguage
        )
    }

    private var textDestination: String {
        guard environment.settings.useReasoningModel || environment.settings.translationEnabled else {
            return AppLocalization.string("privacy.notSent", language: environment.settings.uiLanguage)
        }
        if environment.settings.reasoningProvider == "local" {
            return AppLocalization.string("privacy.onDevice", language: environment.settings.uiLanguage)
        }
        return ReasoningProviderSupport.displayName(
            for: environment.settings.reasoningProvider,
            language: environment.settings.uiLanguage
        )
    }
}
