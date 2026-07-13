# Mouthpiece

Mouthpiece 是一款纯原生 macOS 语音听写应用。它使用 Swift、SwiftUI、AppKit 和 AVFoundation 构建，不包含 Electron、Chromium、React 或 Node.js runtime。

## 系统要求

- 正式兼容并验收 macOS 15 Sequoia 与 macOS 26 Tahoe
- Apple Silicon 或 Intel Mac
- Xcode 26 或兼容的较新版本
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)

项目从 2.0 起只提供 macOS 版本，不再维护 Windows 或 Linux 构建，也不兼容 macOS 14 及更早版本。

## 功能

- 修饰键、组合键、按住说话和点击切换听写
- 独立的翻译快捷键
- 原生录音胶囊，支持多显示器、Spaces 和全屏应用
- 百炼、OpenAI、Deepgram、Soniox、AssemblyAI、Groq、Mistral 和自定义兼容端点
- 本地 Whisper、Parakeet 和 Qwen ASR MLX
- 本地 GGUF 文字整理模型，运行于随包提供的 llama.cpp
- 词典、替换规则、自定义 Prompt、原文历史和敏感应用保护
- Sparkle 应用内更新、GitHub Releases 和 Homebrew cask

## 本地开发

```bash
brew install xcodegen cmake
xcodegen generate
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild -project Mouthpiece.xcodeproj -scheme Mouthpiece \
  -configuration Debug test
```

建议本地使用 Xcode 默认的 DerivedData 目录。若仓库位于 `Downloads`，不要把测试产物写回仓库内，否则 macOS 可能阻止 XCTest runner 读取测试 bundle。

本地模型 runtime 不提交到 Git。需要运行完整本地模型链路时执行：

```bash
scripts/download-native-binaries.sh arm64
# Intel 构建使用：scripts/download-native-binaries.sh x64
```

## 数据与升级

设置保存在 `UserDefaults`，API Key 保存在 macOS Keychain，历史记录位于：

```text
~/Library/Application Support/Mouthpiece/transcriptions.db
```

本地模型继续使用 `~/.cache/mouthpiece/`。原生版首次启动会备份并迁移旧版 Mouthpiece、OpenWhispr 或 VoiceInk 数据，不会重新下载仍然有效的模型。

## 发布

版本号由 `project.yml` 的 `MARKETING_VERSION` 管理。创建 `vX.Y.Z` tag 前，需要准备 `docs/releases/vX.Y.Z.md` 双语说明。Release workflow 会自动构建 arm64 与 x86_64、使用固定自签名身份签名、生成 Sparkle appcast、发布 GitHub Release 并更新 `NotWizard/homebrew-mouthpiece`。

签名和权限保持机制见 [Code Signing Runbook](docs/release/code-signing-runbook.md)。
