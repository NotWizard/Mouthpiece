# Mouthpiece 听写与文字处理可靠性修复方案

## 1. 文档状态与结论

| 项目 | 内容 |
| --- | --- |
| 编写日期 | 2026-09-05 |
| 审查分支 | `main` |
| 审查提交 | `eb9f9f201dc1808cae6c283fc013cf516fff0bf9` |
| 应用版本 | `2.1.3`，build `20103` |
| 当前状态 | 问题已定向复现，修复待实施 |
| 本次交付 | 修复方案及可重建的复现、验收说明；没有修改运行时代码 |

本方案处理四个已经在当前源码上复现的问题，覆盖会话完成、异常清理、流式响应完整性和文字处理超时。不是全仓审计，也不据此认定此前“长时间闲置后首次听写卡住”的唯一根因。

| 编号 | 优先级 | 问题 | 主要影响 | 修复后的目标 |
| --- | --- | --- | --- | --- |
| F1 | P1 | 不自动粘贴时，文字处理完成后的状态判断错误 | 卡在处理中，跳过剪贴板和历史保存 | 按设置完成输出，并正常回到空闲 |
| F2 | P2 | 实时错误事件的清理任务等待自身 | 错误展示结束后不重置，任务和关联资源残留 | 失败路径不自等待，完成资源清理与界面收尾 |
| F3 | P2 | SSE 流内错误被忽略 | 半截文字被作为成功结果输出 | 检测错误及不完整响应，回退到完整原始转录 |
| F4 | P2 | 文字处理超时仍等待不响应取消的任务 | 声明的 8 秒上限失效 | 截止时间到达后返回，迟到结果不能覆盖当前会话 |

建议实施顺序为 **F1 → F3 → F4 → F2 → 集成验收**。F1 先打通共同的完成路径，F3/F4 再验证错误与超时的原文回退，F2 单独处理事件任务生命周期。

## 2. 已有证据与验证范围

### 2.1 定向复现结果

审查时将 `Native/` 与 `project.yml` 复制到临时目录，沿用现有 `DictationCoordinatorTests` 的测试支架。音频、实时服务和 HTTP 响应使用替身；实际执行的是当前版本的协调器、状态机、文字处理服务、历史存储和快照发布逻辑。

测试工具链为 Xcode 26.6（17F113），Debug、arm64、串行测试。没有调用真实 ASR/LLM 服务，没有读取真实 API 密钥，也没有向用户正在使用的应用粘贴测试文字。

| 编号 | 新增于临时副本的用例 | 实际结果 |
| --- | --- | --- |
| F1 | `testAuditReasoningWithoutAutoPasteCompletesAndSavesHistory` | `stop()` 返回后仍为 `processing`；没有 `completed` 快照；历史记录为空 |
| F2 | `testAuditFatalProviderEventResetsAfterErrorDisplay` | 错误后等待 4 秒，仍为 `failed`，没有回到 `idle` |
| F3 | `testAuditReasoningRejectsStreamErrorAfterPartialContent` | 收到流内错误后仍成功返回 `incomplete prefix` |
| F4 | `testAuditReasoningDeadlineDoesNotWaitForUncooperativeTask` | 设置 100 ms 超时，实际约 706 ms 后才返回，等待了原始任务结束 |

合计执行 **4 个用例，6 个断言失败，0 个非预期异常**。F1 同时验证状态、完成快照和历史记录，因此贡献了三个失败断言；这不代表有六个独立问题。

这些结果证明对应代码路径存在缺陷，不代表已经测量了它们在真实用户环境中的发生频率。此次未运行全量性能基准或整套 XCTest。

### 2.2 证据位置与保留方式

原始临时副本：`/tmp/mouthpiece-audit-ZO9DwR`。

- 复现用例：`Native/Tests/DictationCoordinatorTests.swift` 中的四个 `testAudit...` 方法。
- 构建与测试日志：`audit-build.log`。
- 结构化测试结果：`.build/Audit.xcresult`。

临时目录可能被系统清理。本文已记录每个用例的输入、操作、期望和观察结果，实施时应把正式回归用例加入仓库测试集，不能把临时文件当作长期测试资产。

F2 测试结束时出现了 SQLite 临时文件仍被占用的警告：测试支架删除临时目录时，未退出的会话任务仍持有仓库实例。这是该测试的资源释放证据，不能解读为用户真实历史数据库已经损坏。正式用例需先完成关闭/释放，再删除测试目录。

## 3. 共同设计约束

1. 保持现有服务商、模型选择、快捷键和录音参数。四项修复不增加新的设置项。
2. 保持现有文字处理失败时使用原始转录的产品行为。翻译失败也回退原始语言文本，并沿用现有失败提示，不能把失败描述为翻译成功。
3. 自动粘贴、保留剪贴板、保存历史分别遵循已有设置与敏感应用保护；不能为了修复收尾而绕过权限或隐私判断。
4. 正常停止仍须处理已经采集的尾帧和已排队的有效事件。失败、取消、退出则优先释放资源，不能把正常停止所需的等待无条件应用于终止路径。
5. 任何异步操作恢复后，在更改会话状态或产生输出前复核 `sessionID`。旧会话不能覆盖新会话的状态、任务引用或胶囊。
6. 原始转录必须保留到文字处理成功或失败决策完成。文字处理的一部分输出不能代替完整原文。
7. 使用现有 Swift concurrency、Foundation 和 XCTest；不引入第三方依赖，不构建通用任务调度框架。

## 4. F1：关闭自动粘贴后的完成路径

### 4.1 触发条件与根因

条件：启用文字整理或翻译，且不执行自动粘贴。后一种情况既包括用户关闭自动粘贴，也包括未捕获到可插入目标。

当前 `DictationCoordinator.stop()` 在调用文字处理前将状态从 `finalizing` 切换到 `processing`。模型正常返回或失败后采用原文时，状态仍是 `processing`。

收尾逻辑却在没有自动粘贴时固定设置 `completionPhase = .finalizing`，随后调用 `isCurrent(sessionID, phase: completionPhase)`。检查失败后直接 `return`，因此剪贴板、历史、完成快照和重置均未执行。

代码位置（行号以审查提交为准）：

- [文字处理入口与等待](../../Native/Sources/Core/Dictation/DictationCoordinator.swift)：`stop()`，约 398–435 行。
- 同文件 `completionPhase` 分支及输出逻辑，约 446–471 行。
- [状态转换表](../../Native/Sources/Core/Dictation/DictationState.swift)：`DictationStateMachine.allowed` 已允许 `processing → completed`，无需增加新阶段。

### 4.2 修改方案

1. 在文字处理结果和归因日志等 `await` 结束之后，先确认当前会话仍是目标 `sessionID`，且处于 `finalizing` 或 `processing`。
2. 如需自动粘贴且存在目标，沿用 `inserting` 分支。
3. 否则，以经过校验的当前阶段作为完成前阶段，允许 `finalizing` 或 `processing` 进入相同的后续输出流程。不要强行退回 `finalizing`，也不要删除会话校验。
4. 按既有策略执行剪贴板写入和历史保存，再进入 `completed`，展示现有成功反馈后回到 `idle`。
5. 关键 `await` 后继续校验会话身份和阶段。取消或被新会话替代后不再输出，不清空新会话的任务引用。

预期路径：

| 是否执行文字处理 | 是否实际自动粘贴 | 完成前阶段 | 输出成功后的转换 |
| --- | --- | --- | --- |
| 否 | 否 | `finalizing` | `completed → idle` |
| 是 | 否 | `processing` | `completed → idle` |
| 否 | 是 | `inserting` | `completed → idle` |
| 是 | 是 | `inserting` | `completed → idle` |

“保留剪贴板”关闭时不新增剪贴板写入；自动粘贴使用的临时剪贴板及恢复策略继续由 `TextInsertionService` 负责。敏感会话仍按现有保护跳过持久化。

### 4.3 复现与验收

基础复现：实时服务最终返回 `raw transcript`，文字处理返回 `cleaned transcript`，设置 `useReasoningModel = true`、`automaticallyPasteTranscription = false`，开始、注入音频帧、停止。

修复后应同时满足：出现 `completed` 快照；最终为 `idle`；普通会话的历史中 `text` 为处理后文本、`rawText` 为完整原始文本；没有调用自动粘贴。

回归矩阵应覆盖：

- 文字处理开/关与自动粘贴开/关四种组合。
- 剪贴板保留开/关，使用隔离粘贴板或可恢复的快照，不污染真实剪贴板。
- 文字处理成功、报错回退、超时回退。
- 开启自动粘贴但目标为空。
- 等待模型时取消或切换会话，旧结果不能保存、粘贴或发布成功。
- 敏感应用、Secure Input 的现有保护测试继续通过。

## 5. F2：实时错误后的任务自等待

### 5.1 触发条件与根因

百炼或火山引擎等无同服务批量端点的实时路径，在没有任何 partial 时收到 `.error`。当前调用链为：

```text
providerEventTask 消费 .error
  → handle(event:sessionID:)
  → degradeOrFailAfterRealtimeError(...)
  → fail(...)
  → 等待错误展示时间
  → resetIfCurrent(...)
  → drainProviderEventStream()
  → await providerEventTask.value
```

执行清理的就是 `providerEventTask` 本身。等待其 `.value`，意味着它必须先退出才能继续退出，形成自等待。调用 continuation 的 `finish()` 只会结束流，不会让正在执行的事件处理调用自动返回。

代码位置：[DictationCoordinator.swift](../../Native/Sources/Core/Dictation/DictationCoordinator.swift) 中的 `fail`（约 841 行）、`resetIfCurrent`（约 879 行）、`handle(event:)`（约 1053 行）、`drainProviderEventStream`（约 1110 行）。

### 5.2 修改方案

**正常停止与终止清理使用不同语义。**

| 路径 | 处理方式 |
| --- | --- |
| 正常 `stop()` | 保留 `runBoundedStopDrain`，按顺序处理尾帧和已排队事件，继续使用现有时间上限 |
| 失败、取消、最终重置、强制退出 | 完成 continuation、取消 consumer、解除引用，不等待可能是当前任务的 `.value` |

具体步骤：

1. 将终止路径使用的事件清理收敛成一个同步的取消/解除引用方法，替换无界的 `drainProviderEventStream()` 等待。
2. 在同一个 actor 执行片段中取出并清空 `providerEventTask`、`providerEventContinuation`，再结束流并请求取消。该方法内部不 `await`。
3. 让 `resetIfCurrent` 和 `shutdown` 等终止调用者使用该方法。正常停止仍使用已有的有界 drain，不能全局取消所有停止路径的事件消费。
4. 终止事件流之后，已经进入处理函数的旧事件仍可能恢复执行，因此保留并补齐会话/阶段检查，不能依赖 `Task.cancel()` 强制中断代码。
5. 清理只操作对应会话拥有的 provider、PCM、target 和任务。错误展示期间用户启动新会话后，旧会话的延迟重置不得清理新会话。
6. 胶囊隐藏需在 MainActor 上复核展示状态。现有 `CapsuleController.hide()` 无条件隐藏；若终止流程在 `publish()` 与隐藏之间允许新会话出现，应采用仅在胶囊当前为 `idle` 时隐藏的窄方法，避免隐藏新录音。保留 onboarding 所用的无条件隐藏接口。

不要通过“另开一个 Task 调用整个 fail”来掩盖自等待，也不要给自身等待加一个固定 sleep。问题在于终止路径错误地等待 consumer，应该从任务所有权上消除它。

### 5.3 复现与验收

基础复现：启动实时会话，不发送 partial，注入 `.error("audit stream failure")`，等待错误展示结束。当前 4 秒后仍为 `failed`。

修复后应验证：

- 先发布 `failed`，在现有错误展示时间加合理调度余量内回到 `idle`，胶囊消失。
- 事件任务实际退出，不能只把 UI 状态强行设为 `idle`。优先使用任务结束 expectation 或弱引用释放探针；必要时增加一个只在 DEBUG 下可用的结束观察点。
- 相同错误连续发生后仍能开始新的会话，历史仓库、观察者和消费任务不因自等待而残留。
- 在错误展示期间开始新会话，旧错误计时结束后，新会话仍保持录音且胶囊可见。
- 正常停止时全部尾帧到达 provider，已有 partial/final 的顺序测试继续通过。
- 外部取消、重复取消和退出清理可完成，迟到事件不触发新的状态更新。

扩展现有 `testEarlyRealtimeErrorWithoutPartialFailsTheSession`：它当前只确认 `failed` 被发布，需要继续验证恢复空闲和资源释放。

## 6. F3：流式文字处理的错误与完整性校验

### 6.1 触发条件与根因

当前 OpenAI-compatible 路径收到 HTTP 2xx 后，`streamedText(for:)` 只拼接 `choices[].delta.content`。不包含 `choices` 的 JSON 会被跳过，流结束时只要已有非空文字就返回成功。

因此，收到部分内容后发生流内错误或没有正常完成的 EOF，都可能被当成完整结果。上层看到成功，自然不会走已有的原文回退。

已复现的响应：

```text
data: {"choices":[{"delta":{"content":"incomplete prefix"}}]}

data: {"error":{"code":"server_error","message":"stream failed"}}
```

当前返回 `incomplete prefix`。本次用例证明解析器接受了这种异常输入；没有据此声称某个真实服务在本机已返回过同样的错误。

代码位置：[ReasoningService.swift](../../Native/Sources/Integrations/Reasoning/ReasoningService.swift)，`streamedText(for:)`，约 237–265 行。

### 6.2 修改方案

保持一次请求、一次结果的现有调用方式，补齐解析器状态与失败传播：

1. 按 SSE 事件边界解析 `event`/`data`，忽略注释、空心跳和已知的 usage 事件。不要将所有解析失败都静默跳过。若现有 `.lines` 接口无法保留所需边界，在当前服务内部补一个最小事件组装器，不新增第三方库。
2. 拼接内容前先检查错误：包括 `event: error` 以及有效负载的顶层 `error`。错误信息沿用 `providerErrorMessage` / `ProviderErrorSanitizer` 净化，禁止记录原始响应体或凭据。
3. 错误一旦出现立即抛出 `ReasoningServiceError`，不再把已经拼接的部分文字返回给调用者。
4. 只消费本次请求需要的第一条 choice；使用 `index == 0`，对缺少 index 的既有兼容响应按第一条处理。不把不同候选结果拼接成同一份输出。
5. 显式跟踪是否正常完成、是否发生截断，并保留非空结果校验。新增错误类型可采用服务内部的 `incompleteResponse`，或复用现有 `providerResponse`；不增加用户设置。
6. 网络读取异常、取消和解析异常均保留错误语义。协调器按现有策略回退完整原始转录，取消则直接退出，不能误触发一次原文粘贴。

结束状态的判定规则：

| 输入 | 处理规则 |
| --- | --- |
| 非空内容后收到 `[DONE]`，且没有错误或截断状态 | 正常成功；兼容当前不携带 `finish_reason` 的既有测试响应 |
| 非空内容、choice 明确 `finish_reason: stop`，随后正常 EOF | 可视为正常完成，兼容省略 `[DONE]` 的端点 |
| 只有部分内容，既没有 `[DONE]`，也没有正常 finish 标志就 EOF | 抛出不完整响应错误 |
| 明确 `length`、`content_filter` 或不受支持的工具调用结束 | 不接受为完整文字处理结果，走原文回退 |
| 先出现错误/截断，再收到 `[DONE]` | 错误优先，不能用 `[DONE]` 洗掉失败 |
| 收到终止标记但没有有效内容 | 沿用 `emptyResponse` |
| 仅有 usage、注释或心跳 | 不加入文本，也不单独构成完成标志 |

不将“缺少 `[DONE]`”一律判错；已经收到明确正常 finish 标志的服务仍可兼容。对从未发出任何完成信号的自定义端点，需要使用符合以上约定的响应，不能以静默接收半截文字维持兼容。

### 6.3 复现与验收

- 多个正常 delta 拼接正确，usage 和 `[DONE]` 不混入内容。
- 第一条事件就是错误、部分内容后出现错误，均抛错。
- 部分内容后正常 EOF 但无完成信号，抛出不完整响应错误。
- 有明确 `stop` 的正常 EOF 可以成功；`length` 后有 `[DONE]` 仍失败。
- 畸形业务 JSON 不悄悄变成成功；注释、心跳以及合法空 delta 不误报。
- 额外 choice 不与第一条拼接。
- 集成验证：发生流内错误后，最终输出和历史 `text` 使用完整原文，`rawText` 仍保留原文，半截结果不进入剪贴板或插入目标。
- 用真实小文本对本次影响到的 OpenAI-compatible 服务做必要的兼容性抽测；模拟响应测试与真实服务测试分别记录结果。

本项不修改 Anthropic 和 Gemini 的非流式实现，不改 ASR WebSocket 协议。

## 7. F4：真正有界的文字处理等待

### 7.1 触发条件与根因

当前 `reasoningWithTimeout` 用 `withThrowingTaskGroup` 同时等待 `task.value` 与计时器。计时器先到后虽然调用 `task.cancel()` 并抛出超时，但任务组退出仍要等待所有子任务完成。

如果底层操作不响应取消，等待 `task.value` 的子任务不能退出，超时函数也不能返回。取消是请求，不是强制中断线程或 continuation。

定向复现让原始任务通过 continuation 在约 700 ms 后才完成，设置超时为 100 ms。实际在约 706 ms 后返回，超过用例设定的 300 ms 容差上限。

代码位置：[DictationCoordinator+Reasoning.swift](../../Native/Sources/Core/Dictation/DictationCoordinator+Reasoning.swift)，约 16–33 行。

已有参考：[DictationCoordinator.swift](../../Native/Sources/Core/Dictation/DictationCoordinator.swift) 的 `finishWithTimeout` 与 `awaitDrainWithTimeout` 已采用一次性完成门控和 continuation，避免等待输掉竞速的任务。

### 7.2 修改方案

1. 保持生产截止时间为 **8 秒**，测试允许传入更短 `Duration`。使用单调时钟测量时间，避免系统时间调整影响验收。
2. 替换任务组退出时等待所有子任务的结构，采用现有的一次性完成门控模式：模型完成、截止时间、调用方取消三个结果中，第一个获得完成权的结果恢复 continuation。
3. 超时胜出时，向底层请求发送取消并立即返回 `finalizeTimedOut`；不等待底层任务的 `.value` 才返回。
4. 模型成功或报错先完成时，返回对应结果并取消计时器。不能让已完成的每个请求继续保留完整 8 秒的计时任务。
5. 调用方取消先发生时，取消底层操作和计时器，返回 `CancellationError`。使用 `withTaskCancellationHandler` 覆盖取消发生在注册 continuation 之前的情况。
6. 完成门控及任务句柄的注册必须同步保护，保证最多恢复一次；处理“操作极快完成、计时器句柄尚未注册”和“注册前已取消”等竞争。
7. 复用 `ClaimGate` 的设计即可。它当前是协调器内部的 `private` 类型，跨文件 extension 不能直接访问；若直接复用，可最小调整为模块内可见。需要同时管理取消与句柄时，只增加本次竞速必需的状态，不提取成通用 timeout 框架。

### 7.3 协调器中的取消所有权

仅替换超时函数不足以保证用户取消能够立即结束等待：目前 `reasoningTask` 保存的是底层操作任务，`cancel()` 取消它并不能强制结束一个不响应取消的操作。

建议将两层任务的职责明确：

- 底层 operation 只负责 `ReasoningService.process`，使用本次会话捕获的 settings、target 和原文。
- 有界等待任务包装 operation，协调器的 `reasoningTask` 持有该包装任务。
- `cancel()` / `shutdown()` 取消包装任务，由其 cancellation handler 取消 operation 和计时器并结束等待。
- `stop()` 收到 `CancellationError` 后不采用原文回退；收到超时或普通服务错误时，只有原会话仍有效才允许原文回退。
- 清空 `reasoningTask` 前确认仍属于同一会话，防止旧等待返回后把新会话的任务引用清掉。
- 输掉竞速的迟到结果只退出任务，不写剪贴板、历史或胶囊。

本项保证的是：在执行器仍可调度时，调用方不必等待不合作的底层操作结束。它不能强制终止 Swift 线程，也不能单独解决整个 MainActor 或系统音频服务被冻结的问题。

### 7.4 复现与验收

| 场景 | 验收要求 |
| --- | --- |
| 操作立即成功 | 原值返回，不误报超时，计时器被取消 |
| 操作在截止时间前抛错 | 保留原错误，不转换成超时 |
| 可取消的长任务超时 | 返回 `finalizeTimedOut`，底层收到取消 |
| 不响应取消的任务超时 | 调用方在截止时间加容差内返回，不等待原任务完成 |
| 等待开始前已取消或等待期间取消 | 返回取消，不输出原文或迟到结果 |
| 成功/错误/取消/超时近乎同时发生 | continuation 只恢复一次，无崩溃或重复输出 |
| 超时后立即开始新会话 | 旧结果到达不覆盖新状态、不清除新任务、不插入旧文本 |

正式超时回归用可控制的 continuation 作为门闩：保持 operation 未完成，验证 wrapper 已经超时返回，再释放 operation 完成测试清理。将 100 ms 的测试截止时间与宽松的调度容差分开，避免 CI 负载造成误报。现有约 700 ms 的延迟用例可以保留为简单补充，但不能只测试会配合取消的 `Task.sleep`。

## 8. 改动文件与实施步骤

### 8.1 预计改动范围

| 文件 | 预期修改 |
| --- | --- |
| `Native/Sources/Core/Dictation/DictationCoordinator.swift` | F1 完成前阶段；F2 终止清理；F4 包装任务所有权与旧会话保护 |
| `Native/Sources/Core/Dictation/DictationCoordinator+Reasoning.swift` | F4 有界等待、取消传播与竞速清理 |
| `Native/Sources/Integrations/Reasoning/ReasoningService.swift` | F3 SSE 错误、结束状态与响应完整性校验 |
| `Native/Sources/Features/Capsule/CapsuleController.swift` | F2 收尾需要时增加仅空闲状态可隐藏的窄接口，不改视觉样式 |
| `Native/Tests/DictationCoordinatorTests.swift` | 四个基础复现升级为正式回归；补最关键的组合、重试和取消断言 |
| `Native/Tests/DictationAndProviderTests.swift` | 复用或补充 SSE、超时相关测试；避免在两个文件重复同样用例 |
| `CHANGELOG.md` | 每项实际实现后记录到 `[Unreleased]`，不能在只有方案时记为已修复 |

没有新 Swift 文件时不重新生成 Xcode 项目。没有新增用户可见文案时不批量修改本地化文件。测试可以用现有支架和表驱动用例覆盖组合，不要求每个输入组合新增一套独立测试设施。

### 8.2 实施检查表

- [x] 在审查基线完成四项定向复现并保存结论。
- [x] 编写本方案。
- [ ] 将四项复现纳入正式测试，先确认基线按预期失败。
- [ ] 实施 F1，通过完成路径和输出策略回归。
- [ ] 实施 F3，通过流错误、截断和原文回退回归。
- [ ] 实施 F4，通过不合作任务、取消及迟到结果回归。
- [ ] 实施 F2，通过自等待、资源释放和新会话保护回归。
- [ ] 运行集成测试和全量 XCTest，记录通过、失败、跳过原因。
- [ ] 完成必要的本机交互验证，确认无真实输入目标被误写。
- [ ] 按实际结果更新 CHANGELOG 和本方案状态。

本轮仅编写方案。执行修复时再检查实际分支和工作区状态，按届时的用户指令实施；本文不自动授权提交、合并、打 Tag 或发布 Release。

## 9. 整体验收

### 9.1 自动化验证

先跑受影响的 `DictationCoordinatorTests` 与 `DictationAndProviderTests`。四项合并后运行一次全量 XCTest，并确认既有尾帧、事件顺序、敏感应用、Secure Input、历史保存和退出测试没有退化。

推荐命令如下；执行目录为项目根目录，结果目录必须使用尚不存在的新路径：

```bash
env DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  xcodebuild \
  -project Mouthpiece.xcodeproj \
  -scheme Mouthpiece \
  -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -derivedDataPath .build/reliability-audit \
  -resultBundlePath .build/test-results/reliability-fixes.xcresult \
  -parallel-testing-enabled NO \
  test CODE_SIGNING_ALLOWED=NO

git diff --check
```

`DEVELOPER_DIR` 只影响该条命令，不修改系统全局 Xcode 选择。无签名测试构建用于逻辑测试，不代替正式签名应用的权限和自动粘贴验收。Intel 以及 macOS 15/26 的兼容性继续由项目现有 CI 矩阵验证。

不把历史提交信息中的测试数量当成本次实测结果；验收报告应记录实际执行数量、失败数量和跳过原因。不得为了通过本方案的验收而跳过新复现、缩短正确性断言，或只检查函数返回值而不检查最终会话状态。

### 9.2 本机交互验证

| 操作 | 可见结果 |
| --- | --- |
| 开启文字整理，关闭自动粘贴，保留剪贴板 | 处理后文本可手动粘贴，历史有原文与结果，胶囊正常消失 |
| 开启文字整理，关闭自动粘贴及剪贴板保留 | 不改光标处文本、不改原剪贴板，普通会话仍保存历史并结束 |
| 正常自动粘贴 | 仍按既有目标识别与权限逻辑插入，剪贴板恢复策略保持正常 |
| 服务在最早阶段报错 | 错误短暂显示后结束，可再次开始听写 |
| 文字处理期间报错/超时 | 显示既有回退提示，使用完整原始转录收尾 |
| 等待模型时按 Escape，然后开始新会话 | 取消后无迟到粘贴，新会话不被旧结果或旧隐藏动作影响 |

手工测试先在专用测试文本框进行，复制/粘贴内容使用合成测试句。模拟故障由测试替身注入，不为了触发超时去修改真实 API 密钥或生产模型配置。

### 9.3 可观察性与完成标准

继续使用已有日志，不增加逐帧日志或转录正文日志。正常完成应出现 `Dictation session completed`；真正超时应记录 `Text processing finished` 的 `outcome=timeout`；流式错误走 `outcome=error`，不能被记为 `ok`。失败后通过状态观察确认回到 `idle`，不能仅凭错误日志出现就判定清理完成。

四项可标记为完成的必要条件是：原复现不再失败；关键取消/重试边界通过；正常路径回归通过；原始文本不会被异常的部分结果替换；任务结束与资源释放有证据。未完成硬件或真实服务抽测时，明确记录未验证项，不用模拟测试替代结论。

## 10. 提交与发布衔接

四项修复共享协调器，按上述顺序实施可减少冲突。提交时按独立问题组织可审阅的提交，每个提交包含对应实现、必要测试和 CHANGELOG；提交信息遵守 `AGENTS.md` 的中英双语规范。

暂不在本文指定新版本号。收到发布指令后再统一确定版本、整理 `[Unreleased]`、编写中英双语 Release Notes，并按 `Release_Notes_Guidelines.md` 执行发布验证。

如修复后出现回归，优先按问题提交回退到最后通过验证的状态。不要用放宽阶段检查、吞掉流式错误、删除取消检查或增大超时来掩盖回归。四项均不涉及数据库结构或用户配置格式变化，因此不需要数据迁移。
