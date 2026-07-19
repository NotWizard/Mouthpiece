# Mouthpiece 2.0 原生版验收记录

本文档记录可自动执行的原生化验证结果，并列出合并到 `main` 和发布前必须在真实设备上完成的人工验收。兼容基准为最低 macOS 15 Sequoia，正式矩阵为 macOS 15 与 macOS 26 Tahoe。

## 已完成的自动验证

- [x] Swift XCTest：状态机、热键解析、Prompt 安全边界、术语替换、SQLite、LevelDB 导入、设置规范化、日志脱敏、7 天日志清理、语音活动检测和 10 分钟音频处理预算。
- [x] Apple Silicon Release Archive：主程序和本地 ASR 运行时构建成功，主程序目标为 `arm64-apple-macos15.0`。
- [x] Intel Release Archive：主程序和本地 ASR 运行时构建成功，主程序目标为 `x86_64-apple-macos15.0`。
- [x] 原生运行时的 `@rpath` 依赖完整，生成脚本会在依赖或架构不匹配时失败。
- [x] Release App 隔离启动成功，空闲采样为 0% CPU，未启动本地模型时常驻内存约 101 MB。
- [x] 控制面板和 Onboarding 已进行实际界面遍历，简体中文下未发现遮挡、溢出或无法操作的控件。
- [x] 仓库扫描未发现 Electron、React、Node.js、Windows 或 Linux 运行时代码和构建入口。
- [x] Release workflow 会校验证书 SHA-1、SHA-256、完整 Designated Requirement、嵌套签名、最低系统版本、架构、DMG 完整性和隔离启动。

## 发布前真实设备验收

- [ ] 在 macOS 15 与 macOS 26 上分别完成全新安装、首次引导、麦克风和辅助功能授权。
- [ ] 使用百炼、火山引擎、Deepgram、Soniox、AssemblyAI、OpenAI 兼容批量识别及自定义地址各完成一次真实录音。
- [ ] 使用 Whisper、Parakeet 和 Qwen ASR 各完成一次真实录音，并使用任一云端文字处理服务完成一次整理。
- [ ] 在单屏、双屏、不同 Space、全屏应用、显示器热插拔和睡眠唤醒后验证胶囊位置与快捷键。
- [ ] 在原生文本框、Terminal、Safari、Chrome、VS Code 和 Electron 编辑器中验证文本插入与剪贴板恢复。
- [ ] 使用相同自签名证书构建候选版本 A 与 B，分别通过 DMG 覆盖、Sparkle、Homebrew upgrade 和 Homebrew reinstall 验证权限连续性。
- [ ] 在 Apple Silicon 与 Intel 真机上验证 DMG 打开说明、Homebrew 安装和应用内更新。
- [ ] 与 Mouthpiece 1.4.8 在同一台 Mac 上对比空闲 CPU/GPU、常驻内存、胶囊首帧和最终插入延迟。

这些人工项目需要真实 API 凭据、多显示器、两代 macOS 以及两份使用同一私钥签名的候选包，不能由普通单机源码测试替代。全部勾选后，才满足实施方案中的正式发布 Definition of Done。
