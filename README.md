<div align="center">
  <img src="docs/assets/readme/mouthpiece-icon.png" width="128" alt="Mouthpiece 图标" />

  <h1>Mouthpiece</h1>

  <p>
    纯原生 macOS 语音听写工具。<br />
    按下快捷键，说话，文本就会自动出现在你正在使用的应用中。
  </p>

  <p>
    <a href="https://github.com/NotWizard/Mouthpiece/releases/latest">
      <img src="https://img.shields.io/github/v/release/NotWizard/Mouthpiece?style=flat-square&color=1677ff" alt="最新版本" />
    </a>
    <a href="https://github.com/NotWizard/Mouthpiece/actions/workflows/ci.yml">
      <img src="https://github.com/NotWizard/Mouthpiece/actions/workflows/ci.yml/badge.svg" alt="构建状态" />
    </a>
    <img src="https://img.shields.io/badge/macOS-15%2B-111111?style=flat-square&logo=apple&logoColor=white" alt="macOS 15 及以上" />
    <img src="https://img.shields.io/badge/Swift-6.0-F05138?style=flat-square&logo=swift&logoColor=white" alt="Swift 6" />
    <a href="LICENSE">
      <img src="https://img.shields.io/github/license/NotWizard/Mouthpiece?style=flat-square&color=2ea44f" alt="MIT License" />
    </a>
  </p>

  <p>
    <a href="https://github.com/NotWizard/Mouthpiece/releases/latest"><strong>下载最新版本</strong></a>
    ·
    <a href="#快速开始">快速开始</a>
    ·
    <a href="README.en.md">English</a>
  </p>
</div>

<p align="center">
  <img src="docs/assets/readme/mouthpiece-hero.png" width="1200" alt="Mouthpiece 当前原生控制面板与首次引导" />
</p>

## 什么是 Mouthpiece？

Mouthpiece 是一款专为 macOS 打造的语音听写应用。无论你正在写邮件、聊天、记录笔记还是编写文档，只需使用全局快捷键开始说话，Mouthpiece 就能完成语音识别、可选的文本整理与翻译，并将结果插入当前应用。

应用使用 Swift、SwiftUI、AppKit 和 AVFoundation 构建，不包含 Electron、Chromium、React 或 Node.js runtime。你可以在本机运行语音识别，也可以连接自己选择的云服务。

## 核心功能

- **随处听写**：在支持文本输入的 macOS 应用中使用全局快捷键录音并自动插入结果。
- **纯原生体验**：原生窗口、菜单栏、快捷键、音频采集和文本插入，空闲时几乎不占用 CPU 或 GPU。
- **本地或云端识别**：支持本地 Whisper、Parakeet 和 Qwen ASR，也可连接百炼、火山引擎、OpenAI、Deepgram、Soniox、AssemblyAI、Groq、Mistral 及兼容服务。
- **实时听写胶囊**：显示录音状态、音量、实时文本和错误，并适配多显示器、Spaces 与全屏应用。
- **整理与翻译**：支持独立翻译快捷键、自定义 Prompt、个人词典和多种文本处理服务。
- **完整听写控制**：支持按住说话、点击切换、自动判断、Escape 取消、自动粘贴、剪贴板保留和听写时暂停媒体。

## 安装

### 系统要求

- macOS 15 Sequoia 或 macOS 26 Tahoe
- Apple Silicon 或 Intel Mac
- 麦克风权限
- 辅助功能权限，用于全局快捷键和自动插入文本

Mouthpiece 2.0 起仅提供 macOS 版本，不再维护 Windows、Linux 或 macOS 14 及更早版本。

### 下载

1. 前往 [GitHub Releases](https://github.com/NotWizard/Mouthpiece/releases/latest)。
2. 根据 Mac 架构下载对应的 DMG。
3. 打开 DMG，将 `Mouthpiece.app` 拖入“应用程序”文件夹。
4. 首次打开时按照引导授予麦克风和辅助功能权限。

> [!NOTE]
> Mouthpiece 使用稳定的自签名 macOS 身份，目前没有 Apple notarization。手动下载 DMG 后，macOS 可能要求你右键点击应用并选择“打开”，或前往“系统设置 → 隐私与安全性”确认运行。

## 快速开始

1. 安装并打开 Mouthpiece。
2. 按照首次引导授予麦克风和辅助功能权限。
3. 选择本地语音识别，或配置一个云端语音服务。
4. 设置听写快捷键和触发方式。
5. 在任意文本输入位置按下快捷键，说话，然后停止录音。
6. Mouthpiece 会识别语音，并根据设置自动整理、复制或插入结果。

## License

Mouthpiece 以 [MIT License](LICENSE) 开源。
