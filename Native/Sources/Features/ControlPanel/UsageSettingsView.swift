import SwiftUI

struct UsageSettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        SettingsPage(title: "general.title", subtitle: "general.subtitle") {
            SettingsSection(title: "general.interface") {
                SettingsRow(icon: "globe", title: "general.language") {
                    Picker("", selection: settingBinding(environment, \.uiLanguage)) {
                        Text("language.system").tag(UILanguage.system)
                        Text("language.zhHans").tag(UILanguage.simplifiedChinese)
                        Text("language.zhHant").tag(UILanguage.traditionalChinese)
                        Text("language.english").tag(UILanguage.english)
                    }
                    .labelsHidden()
                    .frame(width: 160)
                }
                SettingsRow(icon: "circle.lefthalf.filled", title: "general.appearance", showsDivider: false) {
                    Picker("", selection: settingBinding(environment, \.theme)) {
                        Text("appearance.system").tag(AppTheme.system)
                        Text("appearance.light").tag(AppTheme.light)
                        Text("appearance.dark").tag(AppTheme.dark)
                    }
                    .labelsHidden()
                    .frame(width: 140)
                }
            }

            SettingsSection(title: "general.behavior") {
                SettingsRow(icon: "keyboard", title: "general.hotkey") {
                    HotkeyRecorder(value: settingBinding(environment, \.dictationKey))
                }
                SettingsRow(icon: "hand.tap", title: "general.hotkeyBehavior") {
                    Picker("", selection: settingBinding(environment, \.hotkeyBehavior)) {
                        Text("hotkey.automatic").tag(HotkeyBehavior.automatic)
                        Text("hotkey.toggle").tag(HotkeyBehavior.toggle)
                        Text("hotkey.pushToTalk").tag(HotkeyBehavior.pushToTalk)
                    }
                    .labelsHidden()
                    .frame(width: 160)
                }
                SettingsRow(icon: "power", title: "general.launchAtLogin") {
                    Toggle("", isOn: settingBinding(environment, \.launchAtLogin))
                        .labelsHidden()
                }
                SettingsRow(icon: "dock.rectangle", title: "general.showInDock") {
                    Toggle("", isOn: dockVisibility)
                        .labelsHidden()
                }
                SettingsRow(icon: "menubar.rectangle", title: "general.showInMenuBar") {
                    Toggle("", isOn: menuBarVisibility)
                        .labelsHidden()
                }
                SettingsRow(icon: "escape", title: "general.escapeCancels") {
                    Toggle("", isOn: settingBinding(environment, \.escapeCancelsRecording))
                        .labelsHidden()
                }
                SettingsRow(icon: "speaker.wave.2", title: "general.audioCues", showsDivider: !environment.settings.audioCuesEnabled) {
                    Toggle("", isOn: settingBinding(environment, \.audioCuesEnabled))
                        .labelsHidden()
                }
                if environment.settings.audioCuesEnabled {
                    SettingsRow(icon: "music.note", title: "general.soundPreset", showsDivider: false) {
                        HStack(spacing: 8) {
                            Picker("", selection: settingBinding(environment, \.soundPreset)) {
                                ForEach(AudioCueService.presets) { preset in
                                    Text(preset.name).tag(preset.id)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 170)
                            Button {
                                environment.audioCues.playStart(preset: environment.settings.soundPreset)
                            } label: {
                                Image(systemName: "play.fill")
                            }
                            .help("general.previewSound")
                            .accessibilityLabel("general.previewSound")
                        }
                    }
                }
            }

            SettingsSection(title: "general.microphone") {
                SettingsRow(icon: "mic", title: "general.inputDevice", showsDivider: false) {
                    Picker("", selection: settingBinding(environment, \.selectedMicrophoneUID)) {
                        Text("general.systemDefault").tag("")
                        ForEach(environment.microphones) { device in
                            Text(device.name).tag(device.id)
                        }
                    }
                    .labelsHidden()
                    .frame(width: 250)
                }
            }

            PermissionRows()
        }
    }

    private var dockVisibility: Binding<Bool> {
        Binding(
            get: { environment.settings.showInDock },
            set: { visible in
                var settings = environment.settings
                settings.showInDock = visible
                if !visible, !settings.showInMenuBar {
                    settings.showInMenuBar = true
                }
                environment.saveSettings(settings)
            }
        )
    }

    private var menuBarVisibility: Binding<Bool> {
        Binding(
            get: { environment.settings.showInMenuBar },
            set: { visible in
                var settings = environment.settings
                settings.showInMenuBar = visible
                if !visible, !settings.showInDock {
                    settings.showInDock = true
                }
                environment.saveSettings(settings)
            }
        )
    }
}
