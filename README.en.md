# Mouthpiece

Mouthpiece is a native macOS dictation app built with Swift, SwiftUI, AppKit, and AVFoundation. It contains no Electron, Chromium, React, or Node.js runtime.

## Requirements

- Officially supported and validated on macOS 15 Sequoia and macOS 26 Tahoe
- Apple Silicon or Intel Mac
- Xcode 26 or a compatible newer release
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)

Starting with 2.0, the project ships only for macOS. Windows and Linux builds are no longer maintained, and macOS 14 or earlier is not supported.

## Features

- Modifier-only and combination hotkeys with hold-to-talk and toggle modes
- A separate translation hotkey
- A native dictation capsule across displays, Spaces, and full-screen apps
- Bailian, OpenAI, Deepgram, Soniox, AssemblyAI, Groq, Mistral, and custom compatible endpoints
- Local Whisper, Parakeet, and Qwen ASR MLX transcription
- Terminology, replacements, custom prompts, raw transcript history, and sensitive-app protection
- Sparkle in-app updates, GitHub Releases, and Homebrew cask distribution

## Development

```bash
brew install xcodegen cmake
xcodegen generate
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project Mouthpiece.xcodeproj -scheme Mouthpiece \
  -configuration Debug test
```

Use Xcode's default DerivedData location for local tests. If the repository is under `Downloads`, writing test products back into the repository can prevent the macOS XCTest runner from reading the test bundle.

Native model runtimes are generated and are not committed. To exercise local models:

```bash
scripts/download-native-binaries.sh arm64
# For Intel builds: scripts/download-native-binaries.sh x64
```

## Data and upgrades

Settings use `UserDefaults`, API keys use the macOS Keychain, and history is stored at:

```text
~/Library/Application Support/Mouthpiece/transcriptions.db
```

Local models remain under `~/.cache/mouthpiece/`. On first launch, the native app backs up and migrates legacy Mouthpiece, OpenWhispr, or VoiceInk data without re-downloading valid models.

## Releases

`MARKETING_VERSION` in `project.yml` is the source of truth. Before tagging `vX.Y.Z`, add bilingual notes at `docs/releases/vX.Y.Z.md`. The release workflow builds arm64 and x86_64 packages, applies the stable self-signed identity, generates a Sparkle appcast, publishes the GitHub Release, and updates `NotWizard/homebrew-mouthpiece`.

See the [Code Signing Runbook](docs/release/code-signing-runbook.md) for the permission-preserving signing process.
