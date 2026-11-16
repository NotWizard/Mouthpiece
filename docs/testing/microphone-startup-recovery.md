# 麦克风无数据启动恢复验收

适用：v2.2.2（Build 20202）。排查与首次验证：2026-11-16；发布准备：2026-11-17。

## 现场依据与边界

本机 Mouthpiece 2.2.1 日志在北京时间 2026-11-16 09:10–09:21 和 13:00 附近共记录五次采集启动结束、最终 PCM 为 0 字节。同一时段 SayAll 有遥控器采样入队和排空记录。可确认 Mouthpiece 没有收到转换后的 PCM，现有日志不足以区分虚拟驱动、采集回调和转换阶段。

修复前用真实 AudioCaptureService 配合模拟引擎启动复现：没有收到任何 PCM，start() 仍成功返回。修复后只有有效 PCM 到达才报告就绪；无帧或转换错误最多重新连接一次。恢复只覆盖启动阶段，不承诺修复所有驱动故障或已经进行中的无线链路中断。

## 自动化

Native/Tests/AudioTests.swift 新增检查：

1. 引擎启动成功但无 PCM 时保持等待；正常静音 PCM 可完成启动。
2. 首次没有 PCM，第二次产生 PCM 后恢复。
3. 连续没有 PCM，只尝试两次后失败。
4. 转换失败保留具体错误，不伪装成找不到麦克风。
5. 启动期间停止并立即重新录音，迟到的旧启动结果不停止新会话。

Native/Tests/DictationCoordinatorTests.swift 新增启动等待期间停止的录音保留检查、取消等待时不误报麦克风失败，以及首帧等待期间的音频仍完整发送给实时识别服务的检查。

完整开发环境命令：

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
xcodebuild -project Mouthpiece.xcodeproj -scheme Mouthpiece \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath .build/xcode -clonedSourcePackagesDirPath .build/spm-packages \
  -only-testing:MouthpieceTests/AudioTests \
  -only-testing:MouthpieceTests/DictationCoordinatorTests \
  test CODE_SIGNING_ALLOWED=NO
```

本轮 Xcode 测试被本机未接受的 Xcode 许可协议阻断，未代替用户接受协议，不能声称 XCTest 套件通过。

首次推送后的 macOS 15 CI 实测 200 项通过、0 失败，另有两个麦克风权限用例及一个显式桌面 fixture 用例跳过，触发了现有零跳过门槛。后续让无权限环境通过模拟设备边界执行真实后台 tap 和引擎退役逻辑；需要手动启动 fixture 的纠错集成测试保留在 `scripts/verify-correction-capture.sh`，不纳入默认无交互 CI。统计门槛不放宽，后续以 CI 实际结果为准。

后续 macOS 26 CI 已实测 202 项通过、0 失败、0 跳过，执行数量门槛通过。协调器单元测试进一步固定插入目标，包括没有目标的情况，避免依赖 runner 的真实桌面焦点；桌面端到端行为仍由显式 fixture 验收。

已使用现有 Command Line Tools 编译真实 AudioCaptureService 和 AudioConverterBox，隔离引擎、权限及设备边界执行八项检查：首帧与静音、恢复成功、恢复次数上限、转换错误、旧会话迟到、任务取消、显式输入不可用、48 kHz → 24 kHz 转换。均通过，不访问真实麦克风。

另对协调器的实际补发与帧消费方法做隔离检查，确认启动阶段的 PCM 只发送一次，并保持与后续实时帧的顺序。此检查替换 UI 等待和网络边界，不代表完整应用实测。

全量原生 Swift 源码另用 Command Line Tools 和已安装的 macOS 26.5 SDK 完成类型检查与可执行文件编译链接。此检查不运行应用，不替换 `/Applications/Mouthpiece.app`，不代替 XCTest 或真机验收。

## 真机步骤（尚未执行）

测试前保留当前麦克风选择，确认所用测试构建；需要查看详细事件时开启 Mouthpiece 调试日志。MiRemoteV 和猛玛分别执行，不以一个设备的结果代替另一个。

| 场景 | 操作 | 预期与失败判定 |
| --- | --- | --- |
| MiRemoteV | SayAll 连接遥控器，在 Mouthpiece 连续进行短、长听写 | 每次有 PCM、正常转写；出现“启动成功但最终 0 字节”且无恢复事件即失败 |
| 猛玛 | 连接发射器与接收器，连续进行短、长听写 | 正常采集；静音和说话停顿不触发重试 |
| 设备重连 | 在非录音时断开、重新连接设备，再立即听写 | 等待有效 PCM，必要时最多重连一次；不能无限重试 |
| 系统默认 | Mouthpiece 选“系统默认”，切换系统输入后听写 | 使用当前默认输入；重试不会改写系统默认输入设置 |
| 显式选择 | Mouthpiece 选择具体设备，将其断开后开始听写 | 清楚报告该设备不可用，不擅自选择另一支 |
| 睡眠唤醒 | 两种设备分别在睡眠唤醒后立即、稍等再听写 | UI 保持响应；成功收到 PCM 或有限失败，不能卡死 |
| 快速取消重录 | 在准备中取消，立即重新听写 | 旧启动结果不影响新录音；已收到的 PCM 在正常结束路径中保留 |
| 基线 | 使用内置麦克风和引导页麦克风测试 | 正常启动、波形、结束，转换与尾音不退化 |

## 日志收集

日志目录：`~/Library/Application Support/Mouthpiece/logs/`。记录发生时间、设备型号、Mouthpiece 内的输入选择及是否刚唤醒或重连。

按同一 sessionID 和 attempt 核对：`Audio engine started`、`Audio capture ready`、`Audio conversion failed`、`Audio capture diagnostics`、`Audio capture attempt failed`、`Retrying microphone capture`。设备仅记录名称、当次运行 ID 和 UID 摘要，帧统计不包含语音内容。

`inputBuffers=0` 指向采集回调或设备路径；原始帧存在但 `pcmBytes=0` 时继续检查转换错误。引擎返回成功不再单独作为音频可用的依据。
