<p align="center">
  <img src="src/assets/icon.png" alt="Mouthpiece" width="120" />
</p>

# Mouthpiece

开源桌面听写工作台，支持 macOS、Windows 与 Linux。<br/>
它把“按下热键开始说话、把文本安全送回当前应用”这件事做成了一套完整的桌面流程：录音胶囊、转录引擎、词典、智能后处理、历史记录、权限引导、控制面板和系统更新都已经整合到同一个应用里。

English README: [README.en.md](README.en.md)

## 致敬与来源

Mouthpiece 持续演进自 [OpenWhispr](https://github.com/OpenWhispr/openwhispr) 与 [VoiceInk](https://github.com/le-soleil-se-couche/VoiceInk)。<br/>
感谢这两个上游项目提供的启发与基础。当前仓库的 README、功能说明和使用方式，均以本项目现在的代码实现为准。

## 这是什么

Mouthpiece 适合想把语音输入接到日常桌面工作流中的用户，例如：

- 需要在任意应用里快速输入中文、英文或中英混合文本
- 希望在本地模型和云端模型之间自由切换
- 想要用自定义词典、术语和自动学习提升专有名词命中率
- 需要在转录之后继续做清理、改写、格式化或轻量智能处理
- 希望保留历史记录，并在自动插入失败时有可靠的剪贴板回退

默认使用方式是 BYOK：<br/>
你可以直接使用本地模型，也可以填写自己的 API Key 连接云端 provider。账号登录能力存在，但不是主流程必需项。

## 它现在能做什么

- 通过全局热键启动听写，并在短按/长按之间自动匹配合适的激活方式
- 使用悬浮录音胶囊显示录音状态、音量反馈和实时文本
- 在本地转录与云端转录之间切换，按隐私、速度和成本偏好选择
- 通过自定义词典、术语、自动学习和后处理归一化改善识别结果
- 在转录后接入可选智能层，通过 Prompt Studio 做清理、改写或格式整理
- 把文本自动插入当前应用；如果自动插入失败，会回退到剪贴板并给出明确提示
- 保存历史记录，支持回看、复制和再次使用
- 提供权限引导、系统托盘、控制面板和打包版自动更新体验

## 三分钟上手

### 1. 安装或运行

- 安装包用户：从 [GitHub Releases](https://github.com/NotWizard/Mouthpiece/releases) 下载对应平台版本
- 源码用户：见本文末尾的“从源码运行”

### 2. 首次启动

当前 onboarding 是 4 步：

1. `Welcome`
2. `Permissions`
3. `Hotkey Setup`
4. `Activation`

你可以在这里完成首轮授权、热键设置和听写测试。

### 3. 授权权限

至少要处理两类权限：

- 麦克风权限：用于录音和转录
- 辅助功能权限：用于把结果自动插入其他应用

如果暂时不授予辅助功能权限，Mouthpiece 仍然可以工作，只是会更多依赖复制到剪贴板后手动粘贴。

### 4. 选择转录模式

- 想优先本地隐私：选择本地转录
- 想优先云端模型或实时 provider：选择云端转录

之后再根据你的习惯决定是否开启智能后处理。

### 5. 开始说话

- 按下热键开始听写
- 看悬浮胶囊中的状态和实时文本
- 停止后让 Mouthpiece 自动插入文本，或从历史记录与剪贴板回退中取回结果

## 模式与能力

### 转录模式

| 模式 | 适合场景 | 当前支持 |
| --- | --- | --- |
| 本地转录 | 更注重隐私、离线能力、可控性 | OpenAI Whisper、NVIDIA Parakeet、Qwen ASR MLX |
| 云端转录 | 更注重云端 provider 选择、部分实时链路和托管能力 | OpenAI、Groq、Deepgram、Mistral、Soniox、Alibaba Bailian |

### 本地转录

- **OpenAI Whisper**：经典本地方案，模型选择最完整
- **NVIDIA Parakeet**：基于 sherpa-onnx 的本地转录链路
- **Qwen ASR MLX**：适合 Apple Silicon 本地部署的 Qwen ASR 路线

### 云端转录

- **OpenAI**
- **Groq**
- **Deepgram**
- **Mistral**
- **Soniox**
- **Alibaba Bailian**

其中部分 provider 支持更明确的实时/非实时切换。是否开启 realtime，取决于所选 provider 和当前设置。

### 可选智能层

Mouthpiece 的智能层不是强制主流程，而是一个可选增强层。<br/>
你可以把转录后的文本继续交给本地或云端推理模型做：

- 清理口语化表达
- 调整格式
- 轻量改写
- 固定风格输出
- 按 Prompt Studio 模板做后处理

当前推理 provider 覆盖：

- 云端：OpenAI、Anthropic、Google Gemini、Groq、Alibaba Bailian
- 本地：Qwen、Mistral、Meta Llama、OpenAI OSS、Gemma

### 词典、术语与自动学习

词典系统已经不是单一的“手动加词”：

- 支持自定义词典
- 支持术语配置
- 支持自动学习修正结果
- 支持在后处理阶段做字典归一化

如果你经常输入人名、产品名、内部术语或中英混合短语，这部分会明显改善稳定性。

### 插入策略与回退

Mouthpiece 的目标不是只生成文本，而是尽量把文本送回你当前正在使用的应用。

- 优先尝试自动插入
- 如果当前应用或系统环境不适合直接插入，会回退到剪贴板
- 回退时会明确告诉你结果已经复制，可手动 `Cmd+V` / `Ctrl+V`

这让它更适合浏览器、编辑器、聊天工具、文档工具和混合工作流，而不是只适用于单一输入框。

### 历史记录与控制面板

控制面板当前的主导航包括：

- Home
- Dictionary
- General
- Hotkeys
- Transcription
- Intelligence
- Privacy & Data
- System

在这里你可以查看历史记录、管理词典、切换 provider、设置热键、调整权限、控制更新和修改系统级偏好。

## 权限、隐私与边界

### 权限

- **麦克风权限**：必须，用于录音
- **辅助功能权限**：用于自动插入文本
- 某些平台可能还需要额外的系统设置或粘贴工具配合

### 隐私

- 本地转录时，音频在设备侧处理
- 云端转录或云端推理时，数据会按你选择的 provider 路由和处理
- 默认是 BYOK 模式，云端额度与费用由你自己的 provider 账号承担

### 使用边界

- 登录/账号是可选能力，不是 Mouthpiece 的默认使用前提
- 智能后处理是可选能力，不是转录成功的前提
- 语音识别与后处理都可能出错；涉及法律、医疗、金融等高风险场景时，请务必人工复核

## 进阶文档

| 文档 | 适合什么时候看 |
| --- | --- |
| [LOCAL_WHISPER_SETUP.md](LOCAL_WHISPER_SETUP.md) | 想详细了解本地 Whisper 模型、缓存和运行方式 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 遇到跨平台常见问题时 |
| [WINDOWS_TROUBLESHOOTING.md](WINDOWS_TROUBLESHOOTING.md) | 遇到 Windows 专属问题时 |
| [docs/macos-local-codesign.md](docs/macos-local-codesign.md) | 需要做 macOS 本地签名或稳定辅助功能授权时 |

## 从源码运行

### 开发环境

```bash
git clone https://github.com/NotWizard/Mouthpiece.git
cd Mouthpiece
npm install
npm run dev
```

### 常用命令

```bash
# 类型检查
npm run typecheck

# Lint
npm run lint

# 打包渲染层
npm run build:renderer

# 平台构建
npm run build:mac
npm run build:win
npm run build:linux
```

如果你只是在使用应用，而不是参与开发，优先建议直接从 Releases 下载打包版本。

## Upstream

- [OpenWhispr](https://github.com/OpenWhispr/openwhispr)
- [VoiceInk](https://github.com/le-soleil-se-couche/VoiceInk)

## License

MIT. See [LICENSE](LICENSE).
