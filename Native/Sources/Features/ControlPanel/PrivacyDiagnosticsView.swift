import SwiftUI

struct PrivacyDiagnosticsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "privacy.title", subtitle: "privacy.subtitle") {
            PermissionRows()

            SettingsSection(title: "privacy.diagnostics") {
                SettingsRow(
                    icon: "ladybug",
                    title: "privacy.debugLogging",
                    detail: "privacy.debugRetention",
                    showsDivider: false
                ) {
                    Toggle("", isOn: settingBinding(environment, \.debugLoggingEnabled))
                        .labelsHidden()
                        .toggleStyle(.switch)
                        .controlSize(.small)
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
                SettingsRow(icon: "info.circle", title: "privacy.version", showsDivider: false) {
                    Text(version)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var version: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
    }
}
