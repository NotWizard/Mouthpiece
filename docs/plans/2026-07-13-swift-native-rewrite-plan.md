# Mouthpiece macOS Swift 原生重写完整实施方案

## 1. 文档目标

本方案用于在独立开发分支中将 Mouthpiece 仓库完整重写为纯 Swift 原生 macOS 项目。重写完成并通过全部测试后，将该分支合并到 `main`，再从主分支发布新的正式 Release。

方案只描述最终原生工程的设计、实现、测试和发布要求，不设计 Electron 与 Swift 双轨运行、过渡版本、旧 updater 桥接或其他平台维护方案。合并后的主分支只保留 macOS 原生项目所需内容。

本方案的首要约束是：项目没有 Apple Developer ID，必须继续使用现有自签名证书维持稳定的 macOS Code Signing Designated Requirement，尽最大可能让现有用户升级后不需要重新授予麦克风和辅助功能权限。

## 2. 已确认的前提

### 2.1 产品与平台

- 项目只面向 macOS，不再支持 Windows 或 Linux。
- 重写完成后，从主分支删除所有 Windows、Linux 和通用跨平台兼容代码、构建脚本、二进制、依赖、测试与文档入口。
- 原生版本同时提供 Apple Silicon `arm64` 和 Intel `x86_64` 构建。
- 最低系统版本定为 macOS 15 Sequoia，正式兼容与验收范围为 macOS 15 Sequoia 和 macOS 26 Tahoe（当前大版本及上一代）。Apple 的产品版本号从 macOS 15 直接切换到 macOS 26，并不存在公开发布的 macOS 23；Darwin 23 对应的是 macOS 14 Sonoma。工程不为 macOS 14 及更早版本增加兼容分支。
- 原生版本保持产品名 `Mouthpiece`、应用文件名 `Mouthpiece.app`、Bundle ID `com.mouthpiece.app` 和 URL Scheme `mouthpiece`。
- 生产安装位置继续使用 `/Applications/Mouthpiece.app`。

### 2.2 发布方式

- 继续通过 GitHub Releases 发布 DMG 和 ZIP。
- 继续维护 `NotWizard/homebrew-mouthpiece` Homebrew Tap。
- 继续使用现有自签名证书 `Mouthpiece Code Signing`，不切换为 ad-hoc 签名。
- 不进行 Apple notarization。Apple 明确要求 notarization 使用 Developer ID 证书，自签名证书无法通过 notarization。
- Homebrew 安装继续在 postflight 中移除 quarantine 属性。
- 手动下载 DMG 的用户仍可能看到 Gatekeeper 的“无法验证开发者”提示，需要右键打开或在系统设置中确认；自签名无法消除这一限制。

### 2.3 重写原则

- 最终仓库和 App bundle 中不保留 Electron、Chromium、React 或 Node.js runtime。
- 不保留 Node.js sidecar。
- 不重写 whisper.cpp、llama.cpp、sherpa-onnx、ONNX Runtime 或 MLX 模型本身。
- 仅以现有 macOS 行为作为功能基线，不移植其他平台专属逻辑。
- 所有重写工作在独立分支完成；只有 Definition of Done 全部满足后才合并到 `main`。
- 合并后直接从 `main` 构建并发布新的 macOS Release。

## 3. 当前系统基线

当前仓库约有 5.8 万行 JS、TS、Swift 和 C 代码，118 个测试文件。主要迁移边界如下：

| 当前边界          | 当前实现                               | 原生目标                                         |
| ----------------- | -------------------------------------- | ------------------------------------------------ |
| 应用生命周期      | Electron main process                  | Swift `NSApplication` lifecycle                  |
| 设置与 Onboarding | React、Tailwind、Radix                 | SwiftUI                                          |
| 录音胶囊          | Chromium renderer + BrowserWindow      | AppKit `NSPanel` + SwiftUI content               |
| 录音              | WebAudio、AudioWorklet、MediaRecorder  | `AVAudioEngine`、`AVAudioConverter`              |
| 实时转录          | Node WebSocket helpers                 | `URLSessionWebSocketTask`                        |
| 批量转录与推理    | fetch、Node HTTP                       | `URLSession`                                     |
| 快捷键            | Electron globalShortcut + Swift helper | `CGEventTap`，必要时保留进程内 Globe/Fn 监听逻辑 |
| 文本插入          | Electron clipboard + Swift helper      | `NSPasteboard`、`AXUIElement`、`CGEvent`         |
| 历史记录          | better-sqlite3                         | SQLite3                                          |
| 设置              | Chromium Local Storage + `.env`        | `UserDefaults` + Keychain                        |
| 本地模型          | 外部 server/binary                     | 继续由 `Process` 管理相同二进制                  |
| 自动更新          | electron-updater                       | Sparkle 2 + EdDSA                                |
| 打包              | electron-builder                       | Xcode build + 手工确定性签名 + DMG/ZIP           |

必须把当前 macOS 行为视为重写规范，而不是逐行翻译实现。尤其需要保留：

- 点击、按住和自动判断三类快捷键语义。
- 取消、停止、超时、静音 gate、实时回退和重试语义。
- 百炼、Deepgram、Soniox、AssemblyAI 等 Provider 的实时协议。
- OpenAI 兼容批量转录和自定义端点。
- Whisper、Parakeet、Qwen ASR MLX 本地模型。
- 清理、翻译、词典、术语、安全应用策略和原文历史记录。
- 多显示器、macOS Spaces、全屏 App 和 Stage Manager 下的胶囊显示。
- 调试日志脱敏和 7 天自动清理。
- 原生自动更新、Homebrew 更新和 DMG 发布。

## 4. 成功标准

原生重写只有同时满足以下标准，才允许合并到 `main` 并发布。

### 4.1 功能标准

- 当前 README 中声明的 macOS 功能全部存在。
- 所有当前可用的本地及云端 Provider 均可用。
- 设置、Onboarding、历史、字典、Prompt Studio、权限引导和更新界面均完成原生实现。
- 原生版本可读取现有历史记录、设置、API Key、模型和日志配置。
- 原生版本不会要求用户重新下载仍然有效的本地模型。

### 4.2 权限标准

- 每个原生 Release 使用同一 Bundle ID、同一自签名证书和同一 Designated Requirement。
- 在原生 Release 之间执行覆盖安装、Homebrew reinstall 和自动更新后，辅助功能与麦克风权限保持有效。
- 全新安装能够清晰引导麦克风与辅助功能授权。

### 4.3 性能标准

以最后一个 Electron 正式版为基线，在相同机器、相同 Provider 和相同设置下：

- 空闲状态 CPU 平均占用不高于 1%。
- 控制面板关闭或隐藏时，不存在持续 GPU 活动。
- 空闲常驻内存至少下降 40%，不计已启动的本地模型进程。
- 快捷键触发到胶囊首帧显示的 P95 不高于 100 ms。
- 快捷键触发到首个 PCM frame 的 P95 不高于 150 ms。
- 实时 Provider 的首个 partial transcript 延迟不得劣于 Electron 基线 10% 以上。
- 停止录音到最终文本插入的 P95 不得劣于 Electron 基线。

### 4.4 发布标准

- `arm64` 和 `x86_64` Release 均可构建、签名和安装。
- GitHub ZIP、DMG、Sparkle appcast 和 Homebrew cask 同步生成。
- 从一个原生候选版本自动更新到下一个原生候选版本成功。
- Homebrew install、upgrade、reinstall 均成功。

## 5. 目标工程结构

工程使用一个 Xcode project 和一个主 App target。除 Sparkle 和旧 Local Storage 导入所需的 LevelDB reader 外，不新增第三方运行时依赖。

重写分支在合并前删除：

- `main.js`、`preload.js`、React renderer、Electron helpers 和全部 JS/TS 运行时代码。
- `package.json`、`package-lock.json`、Vite、Tailwind、Electron Builder 和 Node 构建链。
- Windows/Linux 源码、native helper、资源下载器、安装脚本和故障排查文档。
- Windows/Linux GitHub Actions jobs、发布资产和 Homebrew 以外的平台打包配置。
- 只验证 Electron 源码字符串或其他平台行为的旧测试。

保留 `CHANGELOG.md` 中已有的历史记录；历史中出现 Windows 或 Linux 不代表当前版本继续支持这些平台。

```text
Mouthpiece/
  Mouthpiece.xcodeproj
  App/
    MouthpieceApp.swift
    AppDelegate.swift
    AppEnvironment.swift
  Features/
    Onboarding/
    Settings/
    History/
    Dictionary/
    PromptStudio/
    Capsule/
  Core/
    Dictation/
    Audio/
    Transcription/
    Reasoning/
    TextInsertion/
    Persistence/
    Permissions/
    Hotkeys/
    Updates/
  Integrations/
    Providers/
    LocalModels/
    Authentication/
  Resources/
    Assets.xcassets
    Localizable.xcstrings
    Sounds/
    Binaries/
  Migration/
    LegacyEnvironmentImporter.swift
    LegacyDatabaseMigrator.swift
    ChromiumLocalStorageImporter.swift
  Tests/
    Unit/
    Integration/
    Migration/
    UI/
    Fixtures/
```

不为每个目录创建无意义的 protocol、factory 或 manager。只有需要替换实现进行测试，或确实有多个 Provider 实现的边界才使用协议。

## 6. 核心架构

### 6.1 应用状态

使用一个 `AppEnvironment` 持有长期服务实例：

- `DictationCoordinator`
- `AudioCaptureService`
- `HotkeyService`
- `CapsuleController`
- `SettingsRepository`
- `HistoryRepository`
- `TextInsertionService`
- `LocalModelRuntime`
- `UpdateController`

转录会话由一个 Swift actor 串行管理。所有 start、stop、cancel、timeout、provider event 和 fallback 都进入同一个会话状态机，禁止 UI、音频回调和网络回调分别修改会话状态。

建议状态集合：

```text
idle
preparing
recording
stopping
finalizing
inserting
completed
cancelled
failed
```

每个会话拥有不可复用的 session ID。来自旧会话的音频、WebSocket event、timer 和 UI callback 必须因 session ID 不匹配而被丢弃。

### 6.2 UI 分工

- 设置、Onboarding、历史记录、模型选择、字典和 Prompt Studio 使用 SwiftUI。
- 胶囊窗口使用 AppKit `NSPanel` 管理，内容可通过 `NSHostingView` 承载 SwiftUI。
- 菜单栏使用 `NSStatusItem`，不依赖 SwiftUI `MenuBarExtra` 的隐式生命周期。
- 控制面板使用标准 `NSWindow`，恢复上次尺寸和位置，但不得跨屏恢复到不可见区域。
- 设计重构不与原生化同时扩展需求。首个原生版本先实现已确认的第二版控制面板信息架构和一致的 Onboarding 视觉，不新增未存在的产品功能。

### 6.3 胶囊和 Spaces

胶囊应当是非激活、无标题栏、透明背景的 `NSPanel`：

- 不抢占当前输入应用的 key window。
- 使用明确的 window level。
- 使用适合 overlay 的 collection behavior，包括跨 Space 和 full-screen auxiliary 行为。
- 每次录音开始前，根据鼠标所在屏幕重新确认目标 `NSScreen`。
- 用户拖动后的坐标按 display UUID 保存，并限制在该屏幕 visible frame 内。
- 屏幕增减、分辨率变化、睡眠唤醒后重新校正。
- 不通过持续 timer 轮询屏幕状态。

### 6.4 音频链路

使用一个长期存在但按会话启停的 `AVAudioEngine`：

1. 从 `inputNode` 获取硬件格式。
2. 安装 input tap。
3. 用 `AVAudioConverter` 转换为 Provider 所需的单声道 PCM。
4. 音频 callback 只进行固定成本的复制和入队，不在 real-time thread 上执行 JSON、网络、日志或 UI 操作。
5. 独立 actor 负责 PCM 分片、speech gate、预连接缓冲和发送。
6. 停止时先停止接收新 frame，再 flush 当前 buffer，然后请求 Provider finalize。

保留现有 ASR replay fixtures，确保重采样、Int16 编码、静音 gate 和首帧缓存行为一致。

麦克风设备保存稳定设备 UID，不保存 Chromium 的临时 device ID。旧 device ID 无法可靠映射时，首次启动使用系统默认设备，不将迁移失败视为阻塞。

### 6.5 快捷键

- 普通组合键使用进程内 `CGEventTap`。
- Globe/Fn 和左右修饰键逻辑从现有 Swift helper 合并到主 App 内。
- 保留点击、按住和自动模式的阈值与取消行为。
- 捕获新快捷键时临时暂停全局监听，完成或取消后恢复。
- 系统睡眠、唤醒、输入源变化和 event tap 被系统禁用后自动恢复监听。
- 不保留 Electron `globalShortcut` 和独立 `macos-globe-listener` 子进程。

### 6.6 转录 Provider

批量 Provider 使用 `URLSession.data(for:)`，实时 Provider 使用 `URLSessionWebSocketTask`。每个 Provider 只负责协议差异：

- endpoint 和鉴权 header
- 初始化消息
- PCM frame 封装
- partial/final/error event 解析
- finalize/cancel/ping
- 服务端超时和关闭码映射

连接预热、首帧缓冲、retry、fallback 和 session timeline 属于共享会话层，不复制到每个 Provider。

百炼 realtime 必须保留：

- 冷连接期间 PCM 缓冲。
- warm connection 过期策略。
- stale socket 首帧 replay。
- 服务端无事件时的一次受控重试。
- realtime 失败后转 batch 的明确日志和 UI 状态。
- 结束录音后等待 final event 的受控 timeout。

### 6.7 本地模型

首个原生版本继续启动已有外部二进制：

- whisper.cpp / whisper-server
- llama.cpp / llama-server
- sherpa-onnx / Parakeet server
- Qwen ASR MLX runtime

使用 Foundation `Process`、Pipe、HTTP 或 WebSocket 管理。保留现有端口探测、模型目录、下载校验、进程退出和健康检查行为。

所有 bundled executable、dylib、framework 和 helper 必须先于主 App 使用同一自签名证书签名。不得依赖 `codesign --deep --force` 修复错误签名；签名清单必须显式、由内向外执行。

### 6.8 文本插入

文本插入按以下顺序执行：

1. 记录录音前的目标应用和焦点元素。
2. 优先通过 Accessibility API 写入可编辑元素。
3. 不支持直接写入时，使用 `NSPasteboard` + 合成粘贴快捷键。
4. 按现有兼容 profile 处理 Terminal、浏览器编辑器、Electron 编辑器和敏感应用。
5. 在允许恢复时恢复用户原剪贴板内容。

保持现有敏感应用策略和“禁止云端推理、禁止粘贴监控、禁止插入”开关语义。辅助功能 API 返回 `cannotComplete` 时必须区分目标应用忙碌和权限缺失，不能统一提示重新授权。

### 6.9 推理与翻译

- 将现有 Prompt、placeholder、dictionary、terminology profile 和安全边界作为资源和纯 Swift 逻辑迁移。
- 保持清理与翻译共用一次 reasoning 请求的行为。
- 保持 Provider 请求结构和 fallback 行为。
- 本地推理继续通过 llama-server。
- 所有网络错误必须经过统一错误分类，不把用户取消记录为 Provider 故障。

### 6.10 日志

使用 `Logger`/OSLog 记录系统诊断，并在用户开启 Debug 时继续写入可导出的文本日志：

- API Key、Bearer token、用户文本和本地路径按现有规则脱敏。
- Debug 文件保留 7 天。
- 启动时和每天首次写入时清理过期日志。
- 每次会话记录统一 timeline 和 session ID。
- 不在 audio real-time callback 中格式化日志。

## 7. 数据存储重写与兼容

### 7.1 路径保持

Swift App 不使用系统自动推导的新容器路径，明确继续读写：

```text
~/Library/Application Support/Mouthpiece
```

同时保留对旧目录 `OpenWhispr` 和 `VoiceInk` 的一次性探测。生产、staging、development 使用不同后缀，规则与当前 `userDataPathResolver` 一致。

### 7.2 需要兼容的数据

| 数据             | 旧位置                           | 新位置           | 策略                                  |
| ---------------- | -------------------------------- | ---------------- | ------------------------------------- |
| 历史记录         | `transcriptions.db`              | 同一 SQLite 文件 | 原地 schema migration                 |
| API Keys         | `.env`，部分旧值在 Local Storage | Keychain         | 读取后写入 Keychain，保留 `.env` 备份 |
| 快捷键和主要模型 | `.env` + Local Storage           | UserDefaults     | 合并并规范化                          |
| 普通设置         | Chromium Local Storage           | UserDefaults     | allowlist 导入                        |
| 字典和术语       | SQLite + Local Storage           | SQLite           | SQLite 为优先来源                     |
| 模型文件         | 现有模型目录                     | 原路径           | 不移动、不重新下载                    |
| 本地二进制缓存   | userData 子目录                  | 原路径           | 版本校验后复用                        |
| 日志             | `logs/`                          | 同一目录         | 保留并执行 7 天清理                   |

### 7.3 Chromium Local Storage 导入

普通设置大量存在 Chromium `Local Storage/leveldb` 中，不能只迁移 `.env`。原生版本必须包含一个只读、一次性 migrator：

- 使用静态 LevelDB reader 读取旧目录。
- 只读取已知 Mouthpiece origin 和设置 allowlist。
- 实现 Chromium Local Storage value 编码的最小解析，不提供通用浏览器数据库能力。
- API Key 优先从 `.env` 导入；只有 `.env` 缺失对应项时才读取旧 Local Storage。
- 未识别 key 记录名称，不记录 value。
- 导入后不删除旧 LevelDB。
- 用从最后三个 Electron 正式版本采集的脱敏 fixtures 做自动测试。

### 7.4 首次导入事务

首次启动顺序：

1. 获取单实例锁。
2. 创建 `migration-backup-<timestamp>/`，复制 `.env`、SQLite 主文件及 WAL/SHM、设置导出和迁移元数据。
3. 以只读方式收集旧数据。
4. 在内存中完成 schema normalization 和校验。
5. 在 SQLite transaction 中执行数据库迁移。
6. 将 secrets 写入 Keychain。
7. 将普通设置一次性写入 UserDefaults。
8. 写入带源版本和 schema version 的迁移完成 marker。
9. 重新读取所有目标存储并比对关键字段。
10. 成功后启动正常 App；失败则保持旧数据不变并显示可恢复错误。

导入必须幂等。marker 存在但目标数据校验失败时应重新进入恢复流程，而不是跳过。

### 7.5 Keychain

- Keychain service 固定为 `com.mouthpiece.app.credentials`。
- account 使用稳定 Provider key，例如 `bailian-api-key`。
- 不启用需要 Apple Developer provisioning profile 的 Keychain Access Group。
- 写入 Keychain 成功后保留旧 `.env` 作为只读备份，不立即删除。
- 只有用户主动确认时才删除旧明文 secrets，避免导入异常造成凭据丢失。

## 8. 自签名、TCC 与权限延续

### 8.1 正确术语

旧 ad-hoc 构建每次内容变化都会产生新的 `cdhash`。TCC 无法用稳定证书要求识别新版，因此可能要求重新授权。

当前已安装版本的 Designated Requirement 已实测为：

```text
identifier "com.mouthpiece.app" and certificate root = H"db4ffd2432826cb4da396d12cd2b3193e51448d7"
```

Apple TN3127 说明，macOS 会记录应用的 Designated Requirement，并在新版本访问麦克风时检查它是否满足原授权记录。Swift、Electron 或可执行文件内容本身不是身份，只要新 App 满足原 DR，代码实现变化不应导致 TCC 身份变化。

### 8.2 不可变化的签名契约

以下项目在原生化 Release 中必须保持：

- Bundle ID：`com.mouthpiece.app`
- Product name：`Mouthpiece`
- Bundle name：`Mouthpiece.app`
- 生产路径：`/Applications/Mouthpiece.app`
- 自签名证书：现有 `Mouthpiece Code Signing` 私钥和证书
- Certificate root SHA-1：`db4ffd2432826cb4da396d12cd2b3193e51448d7`
- Designated Requirement：与当前正式版一致

证书 CN 相同不代表证书相同。CI 必须校验证书指纹，不能只按 `Mouthpiece Code Signing` 名称查找。

### 8.3 Xcode 签名策略

由于没有 Apple Developer Team：

- Xcode target 使用 manual signing。
- `DEVELOPMENT_TEAM` 留空。
- CI 先构建未签名 Release App，再通过 `codesign` 自底向上签名。
- 主 App 开启 Hardened Runtime。
- 不启用 App Sandbox。当前跨应用 Accessibility、全局事件监听和外部模型进程不适合在本次重构中同时沙盒化。
- 移除 Electron 才需要的 `allow-jit`、`allow-unsigned-executable-memory` 和 `disable-library-validation`。
- 主 App 只保留真实需要的 entitlement，例如音频输入。
- Sparkle framework、XPC services、所有 dylib 和 bundled executable 使用同一身份正确签名。

建议主 App entitlement 基线：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.device.audio-input</key>
  <true/>
</dict>
</plist>
```

实际 entitlement 以功能测试为准，禁止为了让构建通过恢复 Electron 的宽松权限。

### 8.4 CI 硬性校验

Release workflow 必须：

1. 从现有 GitHub Secrets 恢复同一 `.p12`。
2. 提取证书并校验 SHA-1 和 SHA-256 指纹。
3. 如果指纹与仓库记录的公开基线不一致，立即失败。
4. 显式签名所有嵌套代码。
5. 签名主 App。
6. 运行 `codesign --verify --deep --strict --verbose=4`。
7. 读取并规范化 `codesign -d -r-` 输出。
8. 与已提交的完整 DR 基线做精确比较。
9. 运行 `codesign -R '<expected requirement>' --verify`，确认新 App 满足旧要求。
10. 检查所有 Mach-O 文件均非 ad-hoc，并且 Authority 为预期证书。

实现基线已锁定证书 SHA-1 `DB4FFD2432826CB4DA396D12CD2B3193E51448D7`、SHA-256 `AD386695155758F30DEDDDCE3A88022E3A74D2B6B60CD368FD0994DE677BA04F` 与完整 DR。Release workflow 在 `macos-15`、`macos-26` 和 Intel 编译环境中运行测试或构建，任何指纹、DR、签名、部署目标、架构、DMG 完整性或启动冒烟测试异常都会中止发布。

### 8.5 权限连续性真实验证

签名检查不能替代真实安装测试。发布前必须在至少两台干净 Mac 上执行：

1. 安装原生候选版本 A 到 `/Applications/Mouthpiece.app`。
2. 授予辅助功能和麦克风权限。
3. 完成一次录音和文本插入。
4. 记录版本 A 的 DR、证书指纹和权限表现。
5. 使用相同证书构建原生候选版本 B。
6. 通过 Sparkle、Homebrew upgrade 和 DMG 覆盖三种方式分别安装版本 B。
7. 不进入系统设置、不重新授权，直接验证麦克风和文本插入。
8. 确认三个安装路径中的完整 DR 均与基线一致。

测试机器至少覆盖 Apple Silicon 和 Intel。任何安装方式触发重新授权，都必须在发布前修复；不得写入或修改系统 TCC 数据库规避提示。

### 8.6 证书保管

- 继续使用 `MAC_SELFSIGN_CERT_BASE64` 和 `MAC_SELFSIGN_CERT_PASSWORD`。
- 在密码管理器中保留 `.p12`、密码、SHA-1、SHA-256、生成日期和过期日期。
- 至少保留两个离线加密备份。
- 不把私钥写入仓库、Release asset、日志或 Actions artifact。
- 证书计划在 2036-05-13 前轮换；轮换必然需要用户重新授权，应单独发布和说明。
- 新增 Sparkle Ed25519 私钥时，按同等等级备份；它不能替代 Code Signing 证书，两者用途不同。

## 9. 原生自动更新与发布

### 9.1 Sparkle 方案

使用当前稳定版 Sparkle 2，通过 Swift Package Manager 固定精确版本：

- 生成独立 Ed25519 keypair。
- 公钥写入 `SUPublicEDKey`。
- 私钥存入 GitHub Actions Secret，并做离线备份。
- Appcast 和 update archive 均通过 HTTPS 发布。
- ZIP 使用 Sparkle EdDSA 签名。
- 版本比较使用递增 `CFBundleVersion`，展示版本使用 `CFBundleShortVersionString`。
- 自动下载可保持当前用户体验，安装前继续要求用户确认。

不自行实现下载、替换 App、提权和原子安装逻辑。

### 9.2 Release assets

每个原生 Release 至少发布：

```text
Mouthpiece-<version>-arm64.dmg
Mouthpiece-<version>-x64.dmg
Mouthpiece-<version>-arm64-mac.zip
Mouthpiece-<version>-x64-mac.zip
appcast.xml
checksums.txt
```

### 9.3 Homebrew

- 保持 cask token `mouthpiece`。
- 保持 `app "Mouthpiece.app"`。
- 根据架构选择对应 DMG 和 SHA-256。
- 保留 `xattr -dr com.apple.quarantine` postflight。
- Release 完成后自动更新 `NotWizard/homebrew-mouthpiece`。
- CI 安装 cask 后验证 Bundle ID、DR、证书指纹和可执行架构。

### 9.4 DMG

- DMG 只包含 `Mouthpiece.app` 和 `/Applications` 链接。
- App 本体先签名，再创建 DMG。
- 自签名 DMG 不会获得 Apple notarization ticket。
- Release Note 和下载页继续明确手动安装的 Gatekeeper 打开步骤。

## 10. 测试策略

### 10.1 单元测试

使用 Swift Testing 或 XCTest 覆盖真正的状态和协议逻辑：

- Dictation state transitions
- session ID 隔离
- stop/cancel race
- PCM conversion
- speech/silence gate
- Provider event parsing
- retry 和 fallback 决策
- Prompt assembly 和 transcript escaping
- settings normalization
- SQLite migration
- Chromium Local Storage migration
- 日志脱敏与 7 天清理

不迁移当前仅匹配源代码字符串的测试；将其行为要求改写为可执行测试。

### 10.2 Replay 测试

复用现有音频 fixtures 和 ASR benchmark：

- 固定 PCM 输入。
- 记录发往 Provider 的 frame size、sample rate 和时间线。
- 模拟 warm、cold、stale、1006、无 server event 和 final timeout。
- 对比 Electron 基线报告。

### 10.3 集成测试

- Whisper、Parakeet、Qwen ASR MLX 各运行一次真实本地转录。
- 百炼、Deepgram、Soniox 至少各运行一次真实 realtime smoke test。
- OpenAI 兼容 batch 和 Custom endpoint 使用可控 mock server。
- 本地 reasoning 和一个云端 reasoning 完成清理与翻译。
- SQLite WAL 状态下执行迁移和启动。
- Keychain 拒绝、重复写入和旧 `.env` 缺失时行为正确。

### 10.4 macOS UI 与系统测试

覆盖：

- 单屏、双屏、三屏。
- 主屏变化和显示器热插拔。
- 不同缩放比例。
- 普通 Space、全屏 Space、Stage Manager。
- 睡眠唤醒。
- 麦克风拔插、蓝牙切换和系统默认设备变化。
- Terminal、Chrome、Safari、VS Code、原生文本框和 Electron 编辑器中的插入。
- 快捷键冲突、event tap 失效和权限撤销。
- 控制面板隐藏时的 CPU/GPU。

### 10.5 安装与更新矩阵

| 来源         | 目标         | 安装方式           | 必须验证                   |
| ------------ | ------------ | ------------------ | -------------------------- |
| 原生候选版 A | 原生候选版 B | Sparkle            | 权限、设置、历史、模型不变 |
| 原生候选版 A | 原生候选版 B | Homebrew upgrade   | 同上                       |
| 原生候选版 A | 原生候选版 B | DMG 覆盖           | 同上 + Gatekeeper 指引     |
| 原生候选版 B | 同版本 B     | Homebrew reinstall | 权限和数据不变             |
| 全新 macOS   | 原生正式版   | Homebrew           | Onboarding 和授权          |
| 全新 macOS   | 原生正式版   | DMG                | Gatekeeper 和授权          |

## 11. 实施阶段与退出条件

所有阶段都在独立重写分支完成。Definition of Done 全部满足后才合并到 `main` 并发布。

### 阶段 0：冻结基线

工作：

- 建立功能 parity checklist。
- 采集性能、ASR replay 和签名基线。
- 列出全部 macOS 功能、现有数据格式和待删除的非 macOS 文件。
- 保存脱敏 Local Storage、`.env`、SQLite fixtures。

退出条件：所有关键行为都有可运行基线或明确人工测试步骤。

### 阶段 1：工程、签名和数据骨架

工作：

- 建立 Xcode 工程和双架构 CI。
- 打通现有自签名证书的确定性签名。
- 实现现有数据只读扫描、备份和幂等导入事务。
- 实现两个原生候选版本之间的权限连续性测试。

退出条件：候选 Swift App 满足固定 DR，覆盖安装后权限验证通过，所有现有数据可被读取。

这是整个项目的第一个 go/no-go gate。若权限连续性不成立，应在继续大规模 UI 和 Provider 迁移前处理产品决策。

### 阶段 2：原生转录闭环

工作：

- 快捷键、胶囊、AVAudioEngine、百炼 realtime、文本插入。
- 完整 session state machine。
- 多屏和 Spaces 行为。

退出条件：日常百炼 realtime 路径稳定运行，关键性能指标达到门槛。

### 阶段 3：Provider 与本地模型

工作：

- 所有 batch/realtime Provider。
- Whisper、Parakeet、Qwen 和 local reasoning。
- 模型管理、下载、校验和复用。

退出条件：Provider parity checklist 全部通过，ASR replay 不退化。

### 阶段 4：完整产品 UI

工作：

- 控制面板、Onboarding、历史、字典、Prompt Studio。
- 本地化、主题、错误和权限 UI。
- 菜单栏、登录启动和 URL Scheme。

退出条件：所有用户可见功能完成，Accessibility Inspector 和键盘导航通过。

### 阶段 5：更新、发布和稳定性

工作：

- Sparkle、EdDSA、appcast。
- Homebrew cask 和 DMG。
- 双架构完整安装与更新矩阵。
- 删除 Electron、Node、Windows、Linux 和跨平台构建残留。
- 长时间运行、睡眠唤醒和网络故障测试。

退出条件：Definition of Done 全部满足，才允许创建正式 tag。

## 12. CI/CD 目标流程

```text
tag push
  -> validate version and changelog
  -> run Swift unit/integration tests
  -> run ASR replay benchmark
  -> build arm64 unsigned app
  -> build x86_64 unsigned app
  -> restore and fingerprint-check self-signed certificate
  -> sign nested code bottom-up
  -> sign each main app
  -> verify exact DR and entitlements
  -> package ZIP and DMG
  -> EdDSA-sign Sparkle archives
  -> generate appcast.xml
  -> generate checksums
  -> publish GitHub Release
  -> update Homebrew tap
  -> install artifacts on clean runners
  -> verify bundle ID, architecture, DR and launch
```

Release job不得在自签名 Secrets 缺失时回退为 unsigned 或 ad-hoc 构建。缺少证书必须直接失败。

## 13. 风险与处理

| 风险                                 | 处理                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| 换错同名自签名证书                   | 锁定 SHA-1、SHA-256 和完整 DR                                                         |
| Xcode 自动改写签名                   | unsigned build 后手工确定性签名                                                       |
| Local Storage 设置丢失               | 内置只读 LevelDB allowlist importer                                                   |
| Keychain 导入失败                    | 导入后回读校验并保留旧 `.env` 备份                                                    |
| Sparkle 更新链路引入新密钥风险       | Ed25519 私钥独立备份，CI 使用 secret，archives 强制签名                               |
| 本地模型动态库破坏 hardened runtime  | 显式签名全部 nested code，不恢复宽松 JIT entitlement                                  |
| Intel 与 Apple Silicon 行为分叉      | 两套 Release 和更新矩阵，不在运行时下载错误架构                                       |
| 大规模重写出现行为回归               | parity checklist、replay fixtures 和完整 macOS 验收矩阵                               |
| 非 macOS 残留继续增加维护成本        | 合并前扫描源码、依赖、workflow 和 release assets，发现即删除                          |
| 无 notarization 导致 Gatekeeper 阻止 | Homebrew postflight + 明确 DMG 打开说明；加入 Developer Program 后再迁移 Developer ID |

## 14. 明确不做

- 不重写模型引擎。
- 不同时引入 Rust shared core。
- 不保留或重新实现 Windows、Linux 支持。
- 不实现自有自动更新器。
- 不尝试写入或修改系统 TCC 数据库。
- 不在本次重构中加入 App Sandbox。
- 不把原生化与新的转录功能扩展绑定。
- 不因为 SwiftUI 方便而用 SwiftUI Window 替代需要 AppKit 精确控制的胶囊。
- 不在没有两个原生签名版本真实覆盖测试的情况下承诺权限一定不重弹。

## 15. Definition of Done

只有以下项目全部完成，Swift 原生化才算完成：

自动化结果与发布前真机检查统一记录在 [`docs/testing/native-release-acceptance.md`](../testing/native-release-acceptance.md)。源码实现完成不等于可直接发布，真机矩阵仍需在合并和打 tag 前全部通过。

- [ ] macOS 当前功能 parity checklist 全部通过。
- [ ] 主分支和最终 App bundle 中不存在 Electron runtime、React、Node.js 或 Chromium。
- [ ] 主分支中不存在 Windows/Linux 源码、构建 workflow、发布资产或平台依赖。
- [ ] arm64 和 x86_64 构建通过。
- [ ] 所有 nested code 与主 App 使用现有自签名证书签名。
- [ ] 新 App 的完整 DR 与当前正式版基线一致。
- [ ] 原生候选版之间覆盖更新后麦克风无需重新授权。
- [ ] 原生候选版之间覆盖更新后辅助功能无需重新授权。
- [ ] `.env`、Local Storage、SQLite、模型和日志导入成功。
- [ ] 导入失败不破坏现有数据。
- [ ] 所有本地与云端 Provider 通过验收。
- [ ] 多显示器、Spaces、全屏和睡眠唤醒通过验收。
- [ ] 性能指标达到第 4.3 节门槛。
- [ ] Sparkle 可安装原生 Release 更新。
- [ ] Homebrew install、upgrade、reinstall 通过。
- [ ] DMG 手动安装说明与实际 Gatekeeper 行为一致。
- [ ] Release workflow 在证书、DR、签名或架构异常时会硬失败。
- [ ] `CHANGELOG.md` 和中英双语 Release Notes 完成。

## 16. 参考资料

- Apple TN3127, Inside Code Signing: Requirements: <https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements>
- Apple, Notarizing macOS software before distribution: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Apple, Resolving common notarization issues: <https://developer.apple.com/documentation/security/resolving-common-notarization-issues>
- Apple, AVAudioEngine: <https://developer.apple.com/documentation/avfaudio/avaudioengine>
- Apple, NSPanel: <https://developer.apple.com/documentation/appkit/nspanel>
- Apple, URLSessionWebSocketTask: <https://developer.apple.com/documentation/foundation/urlsessionwebsockettask>
- Apple, AXUIElement: <https://developer.apple.com/documentation/applicationservices/axuielement>
- Sparkle documentation: <https://sparkle-project.org/documentation/>
- Current Mouthpiece signing runbook: [`docs/release/code-signing-runbook.md`](../release/code-signing-runbook.md)
- Current local signing guide: [`docs/macos-local-codesign.md`](../macos-local-codesign.md)
- Current release workflow: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
