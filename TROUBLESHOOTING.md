# Troubleshooting

## 快捷键没有响应

在“系统设置 → 隐私与安全性 → 辅助功能”中确认 Mouthpiece 已启用。授权后重新打开 Mouthpiece，或返回控制面板刷新权限状态。

## 无法录音

在“系统设置 → 隐私与安全性 → 麦克风”中启用 Mouthpiece，并在控制面板确认输入设备仍然存在。外接麦克风断开后可切回“系统默认”。

## 胶囊出现在其他桌面或显示器

开始录音前将指针移到当前显示器。Mouthpiece 会在每次会话开始时重新选择指针所在屏幕，并在显示器变化或睡眠唤醒后重新定位。

## 本地模型无法启动

先确认模型在控制面板中显示为“已安装”。若提示 runtime 缺失，请重新安装正式 Release；随包提供的 Whisper、Parakeet 和 llama.cpp 二进制不需要单独配置。Qwen ASR MLX 仅支持 Apple Silicon，并需要可用的 Python 3.10 或更高版本完成首次安装。

## 手动下载后提示无法验证开发者

项目使用固定自签名证书保持麦克风和辅助功能权限，但没有 Apple Developer ID，无法 notarize。手动 DMG 安装可在 Finder 中右键 Mouthpiece 选择“打开”。Homebrew cask 会在安装后移除 quarantine 属性。

## 收集日志

参见 [DEBUG.md](DEBUG.md)。调试日志自动脱敏并保留 7 天。
