# Mouthpiece 阿里云百炼双实时 ASR 模型接入完整方案

## 1. 文档信息

- 状态：待实施
- 日期：2026-08-01
- 目标平台：macOS 原生版本
- 涉及 Provider：阿里云百炼（`bailian`）
- 新增模型：`qwen-audio-3.0-asr-flash-streaming`
- 保留模型：`fun-asr-realtime`
- 默认模型：`qwen-audio-3.0-asr-flash-streaming`

本文定义在现有阿里云百炼实时转录 Provider 中，同时支持 Qwen Audio 3.0 ASR Flash Streaming 和 Fun-ASR Realtime 的完整实施方案。方案覆盖控制面板交互、设置持久化、历史配置迁移、WebSocket 请求、热词、实时结果合并、连接生命周期、错误处理、测试与验收。

本文是后续代码实施的基线，不在本次文档变更中修改运行时代码。

## 2. 背景与目标

Mouthpiece 当前将阿里云百炼 Provider 固定到 `fun-asr-realtime`，控制面板不允许用户切换百炼模型。阿里云现已提供 `qwen-audio-3.0-asr-flash-streaming`，并将其作为实时识别场景的推荐模型。该模型继续使用 WebSocket 流式输入和输出，同时支持即时热词、Prompt 上下文、多语种及方言和字级时间戳。

本次接入目标如下：

1. 保留现有 `fun-asr-realtime`，不删除已有能力。
2. 在同一个百炼 Provider 中新增 `qwen-audio-3.0-asr-flash-streaming`。
3. 用户首次选择百炼时默认使用新模型。
4. 用户可以在两个受支持模型之间明确切换。
5. 历史 Fun-ASR 用户升级后继续使用原模型，不被静默迁移。
6. 两个模型共享现有 WebSocket、音频采集、胶囊和实时结果状态机。
7. 根据模型能力选择合适的热词传递方式。
8. 任何模型失败时都不自动切换到另一个模型，也不进入批量转录兜底。

## 3. 官方能力基线

实施前以以下阿里云官方文档为准：

- [语音识别模型总览](https://help.aliyun.com/zh/model-studio/asr-model/)
- [实时语音识别指南](https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide)
- [Qwen Audio 3.0 / Fun-ASR 实时 WebSocket API](https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api)
- [提升 ASR 识别准确率](https://help.aliyun.com/zh/model-studio/improve-asr-accuracy)

截至本文日期，官方能力对比如下：

| 能力 | Qwen Audio 3.0 ASR Flash Streaming | Fun-ASR Realtime |
| --- | --- | --- |
| 模型 ID | `qwen-audio-3.0-asr-flash-streaming` | `fun-asr-realtime` |
| 工作模式 | 实时 WebSocket | 实时 WebSocket |
| 音频输入 | Binary 流 | Binary 流 |
| PCM 16 kHz 单声道 | 支持 | 支持 |
| 流式文本 | 支持 | 支持 |
| 字级时间戳 | 支持 | 支持 |
| 预编译热词 | 支持 | 支持 |
| 即时热词 `vocabulary` | 支持 | 不作为本方案使用路径 |
| `input.context` | 支持 | 支持 |
| 最大时长 | 无限制 | 无限制 |
| Mouthpiece 中的默认地位 | 新默认 | 兼容保留 |

所有实时模型均要求单声道输入。Mouthpiece 现有 `16 kHz / mono / PCM16` 链路符合要求，不需要调整麦克风采集参数。

## 4. 核心产品决策

### 4.1 一个 Provider，两个模型

不新增第二个阿里云 Provider，也不复制 `BailianRealtimeProvider`。两个模型属于同一账号体系、同一鉴权方式和同一实时协议，应当共享 Provider 实现。

目标结构：

```text
阿里云百炼 Provider
  ├── Qwen Audio 3.0 ASR Flash Streaming（默认）
  └── Fun-ASR Realtime（保留）
```

### 4.2 受控选择，不允许任意输入

百炼模型名称不再是单个固定文本，但也不开放自由输入。控制面板仅提供两个受支持模型，避免用户输入批量模型、旧快照模型或不兼容协议的模型 ID。

### 4.3 新用户默认新模型，旧用户保持原样

- 新安装、首次选择百炼、百炼模型为空：默认 Qwen Audio 3.0。
- 已经保存 `fun-asr-realtime`：继续使用 Fun-ASR。
- 已经保存新模型：继续使用新模型。
- 保存了其他历史百炼模型：归一化为 Qwen Audio 3.0。

### 4.4 不做跨模型自动回退

选中的模型是用户明确配置。Qwen Audio 3.0 连接或识别失败时，不静默切换到 Fun-ASR；Fun-ASR 失败时也不切换到 Qwen Audio 3.0。

这样可以保证：

- 错误信息对应真实模型。
- 费用、语言能力和识别行为可预测。
- 调试日志不会混入第二条隐式链路。
- 避免一次听写中出现两个模型结果拼接。

## 5. 当前实现基线

当前主要实现位于：

- `Native/Sources/Integrations/Providers/BailianRealtimeProvider.swift`
- `Native/Sources/Integrations/Providers/TranscriptionProvider.swift`
- `Native/Sources/Features/ControlPanel/DictationSettingsView.swift`
- `Native/Sources/Core/Persistence/AppSettings.swift`
- `Native/Sources/Core/Dictation/DictationCoordinator.swift`

当前链路具备：

1. 通过 DashScope WebSocket 建立实时任务。
2. 发送 `run-task` 并等待 `task-started`。
3. 将 PCM 音频按 3,200 字节网络块发送。
4. 解析 `result-generated` 的中间句和最终句。
5. 解析句子及字词时间戳。
6. 通过 `finish-task` 完成任务并等待 `task-finished`。
7. 支持百炼连接预热及短时间复用。
8. 通过 `BailianVocabularyService` 管理 Fun-ASR 预编译热词。

当前限制：

- `BailianRealtimeProvider.model` 固定为 `fun-asr-realtime`。
- `run-task` 使用固定模型，而不是配置中的模型。
- `AppSettings.normalize()` 会强制把百炼模型改回固定模型。
- 控制面板选中百炼时自动写入固定模型。
- 热词服务的目标模型和缓存逻辑隐含依赖单模型假设。

## 6. 目标模型定义

在现有百炼集成内部增加一个轻量、受控的模型枚举：

```swift
enum BailianASRModel: String, CaseIterable, Codable, Sendable {
    case qwenAudio3 = "qwen-audio-3.0-asr-flash-streaming"
    case funASR = "fun-asr-realtime"

    static let defaultModel: Self = .qwenAudio3
}
```

枚举只负责真实存在的差异：

- API 模型 ID。
- 控制面板显示名称。
- 本地化说明。
- 热词策略。

不为两个枚举值建立 factory、protocol 或独立 Provider 类型。

建议增加的最小派生信息：

```swift
extension BailianASRModel {
    var displayNameKey: String { ... }
    var helpTextKey: String { ... }
    var hotwordStrategy: HotwordStrategy { ... }
}
```

其中热词策略仅需区分：

```text
Qwen Audio 3.0 → inlineVocabulary
Fun-ASR        → precompiledVocabularyID
```

## 7. 控制面板交互方案

### 7.1 模型选择位置

用户选择“阿里云百炼”后，在“服务配置”中按照以下顺序展示：

1. API 密钥
2. 模型名称
3. 实时转录状态

“模型名称”一行由固定文本改为右对齐下拉框。由于模型名称较长，不使用横向分段控件。

### 7.2 下拉选项

| 显示名称 | 实际保存值 |
| --- | --- |
| Qwen Audio 3.0 ASR Flash Streaming | `qwen-audio-3.0-asr-flash-streaming` |
| Fun-ASR Realtime | `fun-asr-realtime` |

下拉框只显示这两个选项，不提供“自定义”和可编辑文本框。

### 7.3 帮助提示

在模型名称旁增加信息按钮或原生 Help Tooltip。

Qwen Audio 3.0 提示：

> 新一代实时语音识别模型，支持即时热词、Prompt 上下文、多语种及方言和字级时间戳。

Fun-ASR 提示：

> 实时语音识别模型，支持热词和字级时间戳，保留用于兼容已有配置。

### 7.4 选择行为

- 首次从其他 Provider 切换到百炼且没有有效的百炼模型记录时，选择 Qwen Audio 3.0。
- 用户手动选择 Fun-ASR 后立即保存。
- 切换到其他 Provider 再回到百炼时，恢复上次有效选择。
- 模型切换只影响下一次听写，不中途切换正在运行的会话。
- 听写进行中可以禁用模型选择控件，避免界面显示值与活动会话不一致。

### 7.5 实时转录状态

两个模型均为实时专用模型。百炼 Provider 继续不提供关闭实时转录的开关，也不展示批量回退选项。界面可以显示“实时转录”已启用的只读状态，但不能切换到非实时链路。

## 8. 设置持久化与迁移

### 8.1 保存字段

继续使用现有 `cloudTranscriptionModel`，不新增第二个重复字段。用户选择百炼模型时保存模型的 API ID。

如果现有 Provider 切换逻辑会覆盖 `cloudTranscriptionModel`，应增加一个最小的百炼上次选择记录；只有确认当前单字段无法恢复用户选择时才新增，例如：

```swift
var bailianTranscriptionModel = BailianASRModel.defaultModel.rawValue
```

优先复用现有设置结构，不提前为所有 Provider 建立通用的按 Provider 配置字典。

### 8.2 归一化规则

`AppSettings.normalize()` 按下表处理：

| Provider | 保存模型 | 归一化结果 |
| --- | --- | --- |
| `bailian` | `fun-asr-realtime` | 保留 Fun-ASR |
| `bailian` | `qwen-audio-3.0-asr-flash-streaming` | 保留 Qwen Audio 3.0 |
| `bailian` | 空字符串 | Qwen Audio 3.0 |
| `bailian` | 其他不受支持值 | Qwen Audio 3.0 |
| 非 `bailian` | 任意 | 沿用对应 Provider 现有规则 |

### 8.3 升级行为

现有 2.x 用户通常保存的是 `fun-asr-realtime`，升级后必须继续使用 Fun-ASR。不能因为 Qwen Audio 3.0 成为默认模型，就覆盖这批用户的既有配置。

### 8.4 首次选择行为

当用户首次选择百炼时：

```text
没有百炼历史模型 → Qwen Audio 3.0
有有效百炼历史模型 → 恢复历史模型
历史模型非法       → Qwen Audio 3.0
```

## 9. 实时 WebSocket 协议

### 9.1 共享状态机

两个模型继续使用同一条任务状态机：

```text
connect
  → run-task
  → task-started
  → binary audio + result-generated
  → finish-task
  → remaining result-generated
  → task-finished
  → close
```

不新增 SDK，不复制 WebSocket 客户端，不引入第二套回调模型。

### 9.2 共享鉴权

继续使用百炼 API Key：

```http
Authorization: Bearer <API_KEY>
```

API Key 继续存储在现有 Keychain 账户中。两个模型共享同一百炼凭据，不新增模型级 API Key。

### 9.3 模型选择进入会话配置

`BailianRealtimeProvider.start` 和 `warmup` 必须使用调用时的 `RealtimeTranscriptionConfiguration.model`，并先转换为 `BailianASRModel`。

非法值处理：

- 设置层应当提前归一化。
- Provider 边界仍需验证。
- Provider 收到非法值时返回明确的“不支持的百炼 ASR 模型”错误，不能默默改成默认值。

### 9.4 共享音频参数

两个模型统一使用：

```json
{
  "format": "pcm",
  "sample_rate": 16000
}
```

并继续使用：

- 单声道 PCM16。
- 现有 3,200 字节发送块。
- 现有音频积压和顺序发送机制。
- 现有 VAD 静音参数 `max_sentence_silence`。

### 9.5 Endpoint 决策

第一阶段继续使用现有 DashScope WebSocket Endpoint，不在本次模型接入中增加 Workspace ID、地域选择或 Endpoint 配置。

官方新的业务空间域名依赖 Workspace ID 和地域配置。Mouthpiece 当前只要求 API Key，若本次同时引入 Workspace ID 会扩大设置、迁移和验证范围，与新增模型无直接关系。

后续只有在旧 Endpoint 被明确下线，或用户需要北京与新加坡业务空间精确路由时，再单独设计地域和 Workspace ID 设置。

## 10. 热词与词典接入

### 10.1 共同输入来源

两个模型继续使用 Mouthpiece“词典”里的 `preferredTerms`。避免术语和替换规则不进入 ASR 热词：

- `preferredTerms`：进入 ASR 热词。
- `avoidedTerms`：仅用于后处理，不进入热词。
- `replacementRules`：仅用于后处理，不进入热词。

发送前继续完成：

- 去除空白。
- 大小写不敏感去重。
- 过滤不符合官方热词长度规范的条目。
- 使用稳定顺序，保证请求和测试可复现。

### 10.2 Qwen Audio 3.0 即时热词

Qwen Audio 3.0 使用请求内联的 `parameters.vocabulary`：

```json
{
  "parameters": {
    "format": "pcm",
    "sample_rate": 16000,
    "vocabulary": {
      "Mouthpiece": 4,
      "百炼": 4
    }
  }
}
```

规则：

- 普通热词默认权重为 `4`。
- 第一阶段不自动使用权重 `50` 的超级热词。
- 热词为空时不发送 `vocabulary` 字段。
- 不同时发送 `vocabulary_id`。
- 词典修改在下一次听写立即生效，不创建远端资源。

官方说明即时热词和预编译热词同时存在时，只有即时热词生效，因此 Qwen Audio 3.0 路径必须保证请求中没有旧 `vocabulary_id`。

### 10.3 Fun-ASR 预编译热词

Fun-ASR 保留现有 `BailianVocabularyService`：

1. 根据词典内容创建或更新远端热词表。
2. 等待热词表可用。
3. 在 `run-task` 中传入 `vocabulary_id`。
4. 热词服务异常时沿用当前可接受的降级策略：记录警告，继续启动无热词的 Fun-ASR 实时任务。

Fun-ASR 请求中不发送 Qwen Audio 3.0 的即时 `vocabulary`。

### 10.4 热词缓存隔离

现有热词服务必须显式绑定 Fun-ASR，不能再通过“默认百炼模型”推导 `target_model`。

最低要求：

- `target_model = fun-asr-realtime`。
- 缓存键包含 API 账户标识和词典摘要。
- 远端列表查询确认 `target_model` 一致。
- 不把 Fun-ASR 的 `vocabulary_id` 传给 Qwen Audio 3.0。

如果未来也为 Qwen Audio 3.0 启用预编译热词，再将缓存键扩展为模型维度。本方案中 Qwen Audio 3.0 使用即时热词，因此不需要为它增加远端缓存。

### 10.5 上下文增强

两个模型官方均支持实时 `input.context`，但本次不新增“ASR 上下文 Prompt”设置。

第一阶段规则：

- 词典术语只进入对应模型的热词机制。
- 不把同一组 `preferredTerms` 同时重复传入热词和 `input.context`。
- 不在任务运行中发送 `continue-task` 更新上下文。

未来如果产品增加“会议背景”“项目名”“对话历史”等独立上下文来源，再单独实现 `input.context`。

## 11. 连接预热与生命周期

### 11.1 保留现有预热机制

本次不删除百炼现有预热能力。模型必须成为预热配置身份的一部分：

- API Key、模型、采样率、语言、静音配置或词典策略发生变化时，不复用旧预热连接。
- 已为 Fun-ASR 预热的连接不能用于 Qwen Audio 3.0。
- 已为 Qwen Audio 3.0 预热的连接不能用于 Fun-ASR。

### 11.2 模型切换

用户切换模型后：

1. 保存新模型。
2. 取消或过期旧模型的暖连接。
3. 仅在现有预热触发点为新模型建立连接。
4. 不影响已经开始的听写会话；新选择从下一次听写生效。

### 11.3 完成与取消

两个模型继续共享现有行为：

- 正常停止：发送 `finish-task`，其中保留必需的空 `payload.input = {}`。
- 等待剩余 `result-generated` 和 `task-finished`。
- 超时：走现有 finalize 超时和最新 partial 结果处理。
- 用户取消：取消接收任务、关闭 WebSocket、丢弃该会话结果。
- 旧会话事件：通过 generation/session 标识丢弃。

## 12. 实时结果与时间戳

### 12.1 共享解析器

继续复用现有：

- `BailianMessageParser`
- `BailianSentence`
- `TranscriptJoiner`
- 已提交文本与当前活动句合并逻辑

不为 Qwen Audio 3.0 建立第二套结果模型，除非真实响应样本证明字段结构存在不可兼容差异。

### 12.2 中间结果

收到未结束句子时：

- 更新当前活动句。
- 不重复写入已提交文本。
- 向胶囊发送 partial transcript。
- 保留现有两行滚动展示行为。

### 12.3 最终结果

收到最终句子时：

- 使用句子开始时间或现有稳定标识去重。
- 将最终句提交到 committed text。
- 清空对应 active text。
- 向协调器发送 final update。

### 12.4 字级时间戳

补充 Qwen Audio 3.0 的真实响应 Fixture，验证：

- `begin_time` 与 `end_time`。
- `words` 数组。
- 标点位置。
- 中英文混合时的空格拼接。
- 同一句多次 partial 更新后只生成一个 final。

时间戳第一阶段只用于平滑文本更新和正确去重，不新增单词级动画或历史时间轴功能。

## 13. 错误处理

### 13.1 错误分类

统一使用“百炼实时转录”错误命名，避免所有错误都写成 Fun-ASR：

- API Key 缺失或无效。
- 不支持的百炼模型。
- WebSocket 连接失败。
- 等待 `task-started` 超时。
- 服务端 `task-failed`。
- 音频发送失败。
- 服务端长时间无响应。
- `finish-task` 或 `task-finished` 超时。
- 响应格式无法解析。

### 13.2 用户可见信息

错误信息至少包含当前模型的显示名称，但不得暴露 API Key、完整请求头或词典全文。

示例：

```text
Qwen Audio 3.0 ASR Flash Streaming 连接失败。
Fun-ASR Realtime 未在规定时间内返回任务开始事件。
```

### 13.3 不允许的行为

- 不因 Qwen 失败切换到 Fun-ASR。
- 不因 Fun-ASR 热词服务失败切换到 Qwen。
- 不进入批量 HTTP 转录。
- 不把一个模型的 partial 交给另一个模型继续完成。

## 14. 日志与诊断

Debug 日志增加以下非敏感字段：

- `provider=bailian`
- `model=qwen-audio-3.0-asr-flash-streaming` 或 `fun-asr-realtime`
- 热词策略：`inline`、`precompiled` 或 `none`
- 热词数量，不记录热词正文。
- 是否复用预热连接。
- `task-started`、首个 partial、首个 final 和 `task-finished` 的耗时。

禁止记录：

- API Key。
- Authorization Header。
- 完整热词表。
- 完整音频数据。
- 用户完整转录正文，除非现有 Debug 策略明确允许并完成脱敏。

## 15. 安全与隐私

- API Key 继续存储在 Keychain，不进入 `UserDefaults`。
- 模型选择可以存储在普通设置中。
- 即时热词随 Qwen Audio 3.0 请求发送到百炼；控制面板现有云端处理说明应覆盖这一行为。
- Fun-ASR 预编译热词会创建百炼账号下的远端资源；继续遵循当前远端词表清理与数量限制。
- 切换模型不复制或导出 API Key。

## 16. 代码改动清单

### 16.1 `BailianRealtimeProvider.swift`

- 增加 `BailianASRModel`。
- 将单个 `static model` 改为受支持模型目录和默认模型。
- `run-task` 使用配置中经过验证的模型。
- 根据模型选择即时热词或 `vocabulary_id`。
- 保持现有网络状态机、解析器、完成和取消流程。
- 将仅提及 Fun-ASR 的错误文案改为模型中性文案。
- 确保预热连接按模型隔离。

### 16.2 `TranscriptionProvider.swift`

- 将实时配置默认百炼模型更新为 Qwen Audio 3.0，或取消协议层对具体百炼模型的硬编码。
- 保证 `model` 继续参与配置相等判断，防止跨模型复用连接。

### 16.3 `DictationSettingsView.swift`

- 百炼配置显示两项模型 Picker。
- 首次选择百炼时使用新默认模型。
- 恢复有效历史模型。
- 增加两种模型的本地化帮助提示。
- 听写期间禁用模型切换。

### 16.4 `AppSettings.swift`

- 移除“百炼永远强制为单一模型”的归一化逻辑。
- 使用受支持模型集合完成归一化。
- 保留历史 `fun-asr-realtime`。
- 空值和非法值使用新默认模型。

### 16.5 `DictationCoordinator.swift`

- 构造实时配置时传入用户选择的百炼模型。
- 预热和正式启动使用同一模型配置。
- Provider 路由仍然只按 `bailian` 选择 `BailianRealtimeProvider`，不按模型复制路由分支。

### 16.6 本地化资源

新增：

- 两个模型的显示名称。
- 两个模型的帮助提示。
- 不支持模型错误。
- 模型相关连接错误模板。

### 16.7 测试与 Changelog

- 更新现有固定 Fun-ASR 的断言。
- 增加双模型请求、迁移、热词和解析测试。
- 在 `CHANGELOG.md` 的 `Unreleased` 记录新增百炼模型选择能力。

## 17. 测试方案

### 17.1 设置测试

1. 新设置默认百炼模型为 Qwen Audio 3.0。
2. 历史 Fun-ASR 设置归一化后保持不变。
3. 新模型设置归一化后保持不变。
4. 百炼空模型归一化为新模型。
5. 百炼未知模型归一化为新模型。
6. 非百炼 Provider 不受影响。
7. 用户切换到 Fun-ASR 后重新启动仍保持 Fun-ASR。

### 17.2 请求载荷测试

Qwen Audio 3.0：

- `model` 为新模型 ID。
- `format=pcm`。
- `sample_rate=16000`。
- 有词典时包含 `parameters.vocabulary`。
- 热词权重默认是 `4`。
- 不包含 `vocabulary_id`。

Fun-ASR：

- `model=fun-asr-realtime`。
- 继续请求并传入正确的 `vocabulary_id`。
- 不包含即时 `vocabulary`。
- 热词服务失败时仍可启动无热词任务。

### 17.3 状态机测试

- 两个模型都完成 `run-task → task-started → audio → finish-task → task-finished`。
- `finish-task` 继续包含空 `payload.input`。
- 切换模型后不复用旧模型预热连接。
- 旧模型连接返回的迟到事件不能污染新会话。
- 连接和 finalize 超时正确释放资源。

### 17.4 结果解析测试

- Qwen Audio 3.0 partial 逐步更新。
- Qwen Audio 3.0 final 替换对应 partial。
- Fun-ASR 现有解析测试继续通过。
- 字词时间戳、标点和中英文混排正确。
- 重复 final 不会重复追加。

### 17.5 控制面板测试

- 选择百炼后显示模型 Picker。
- 首次选择默认 Qwen Audio 3.0。
- 选择 Fun-ASR 后保存并恢复。
- 其他 Provider 不显示百炼模型 Picker。
- 当前模型的帮助提示正确。

## 18. 手工验收矩阵

| 场景 | Qwen Audio 3.0 | Fun-ASR |
| --- | --- | --- |
| 首次连接 | 必测 | 必测 |
| 连续第二次听写 | 必测 | 必测 |
| 中文普通话 | 必测 | 必测 |
| 中英文混合 | 必测 | 必测 |
| 方言样本 | 必测 | 建议 |
| 无词典 | 必测 | 必测 |
| 含词典 | 必测 | 必测 |
| 停止并获取 final | 必测 | 必测 |
| 快捷键再次取消 | 必测 | 必测 |
| Escape 取消 | 必测 | 必测 |
| Wi-Fi 中断 | 必测 | 必测 |
| 切换模型后立即听写 | 必测 | 必测 |
| App 长时间空闲后首次听写 | 必测 | 必测 |

## 19. 性能验收

在相同 Mac、麦克风、网络和测试语料下记录：

- 快捷键触发到 `task-started`。
- 快捷键触发到首个 partial。
- 停止到 final。
- 连续语音的 partial 更新间隔。
- 30 分钟会话内存增长。
- 空闲预热连接的 CPU 和网络活动。

本次接入不得造成：

- 胶囊首帧延迟明显增加。
- 音频发送队列持续积压。
- 主线程执行 JSON 解析或热词网络请求。
- 模型切换后重复建立多条活动连接。

## 20. 实施顺序

### 阶段一：模型目录与设置

1. 增加 `BailianASRModel`。
2. 修改默认模型和归一化规则。
3. 增加控制面板模型选择与本地化。
4. 完成设置和迁移测试。

完成标准：历史 Fun-ASR 保留，新选择百炼默认 Qwen Audio 3.0。

### 阶段二：请求与热词

1. `run-task` 使用配置模型。
2. Qwen Audio 3.0 接入即时热词。
3. Fun-ASR 保留预编译热词。
4. 隔离热词和预热状态。
5. 完成请求载荷测试。

完成标准：两个模型都能以正确载荷进入 `task-started`。

### 阶段三：解析与生命周期

1. 加入 Qwen Audio 3.0 响应 Fixture。
2. 验证 partial、final 和时间戳。
3. 验证 finish、cancel、timeout 和迟到事件。
4. 完成连续会话测试。

完成标准：两个模型共享状态机且结果互不污染。

### 阶段四：真实服务验收

1. 使用真实百炼 API Key 测试两个模型。
2. 完成词典、方言、混合语言和网络异常测试。
3. 比较首字延迟、final 延迟和转录准确率。
4. 检查 Debug 日志脱敏。

完成标准：手工验收矩阵通过，没有跨模型自动回退。

## 21. Definition of Done

本功能只有同时满足以下条件才算完成：

- 百炼 Provider 可以选择两个指定实时模型。
- 首次选择百炼默认 Qwen Audio 3.0。
- 历史 Fun-ASR 用户不被迁移。
- 模型选择可以持久保存和恢复。
- Qwen Audio 3.0 使用即时热词。
- Fun-ASR 继续使用预编译热词。
- 两个模型均使用现有 16 kHz 单声道 PCM 链路。
- partial、final、字级时间戳和标点解析正确。
- 预热连接不会跨模型复用。
- 完成、取消、超时和断线均释放资源。
- 任一模型失败时不自动切换模型或进入批量兜底。
- 单元测试、Provider 测试和真实服务验收通过。
- `CHANGELOG.md` 已同步更新。

## 22. 明确不做的内容

本次不实施：

- 不新增第二个百炼 Provider。
- 不开放任意模型 ID 输入。
- 不支持 Qwen Audio 文件转写模型。
- 不支持 Fun-ASR 快照版本选择。
- 不新增批量转录回退。
- 不新增跨模型自动回退。
- 不新增 Workspace ID 或地域设置。
- 不切换到阿里云 iOS SDK、DashScope SDK 或 AOQ 协议。
- 不新增 ASR 上下文 Prompt 编辑器。
- 不增加超级热词 UI 和权重编辑器。
- 不重构无关 Provider 或音频采集代码。

以上能力只有在出现明确产品需求或现有 Endpoint、协议无法继续使用时，再单独立项。
