# AI 翻译输出（统一目标语言）— 设计文档

> **For Claude:** 本文是设计文档，不是 implementation plan。Implementation plan 由 `superpowers:writing-plans` skill 在 worktree 中单独产出，命名 `2026-05-22-ai-translation-output-plan.md`。本设计仅锁定决策、约束、接口与边界，不规定文件级改动顺序。

**目标 / Goal**：在现有转录 + AI 修正（cleanup）管道之上新增"AI 翻译输出"能力。开启后，转录文本与 cleanup 在**单次 LLM 调用**中合并执行，最终统一为用户配置的目标语言输出。设计上对 4 个 reasoning provider（OpenAI / Anthropic / Gemini / Local）零侵入：翻译完全表现为 system prompt 的一种变体。

---

## 1. 锁定的决策清单

| # | 决策 | 关键理由 |
|---|---|---|
| 1 | **替换式输出**：杂语输入 → 统一一种语言输出，不做双语对照 | 用户主场景是"我说杂语，统一成一种"，双语对照不在 v1 范围 |
| 2 | **固定单一目标语言**：UI 上设置一次永久生效 | 不需要快捷键切换器、不需要按窗口记住默认 |
| 3 | **共用 provider/模型**：翻译复用 `reasoningProvider` / `reasoningModel`，不为翻译单独配置 | 用户不需要"两步用不同模型"的能力 |
| 4 | **B 方案：一次合并 LLM 调用** | 拒绝 A 方案"两步独立"的延迟翻倍、成本翻倍代价 |
| 5 | **UI 暴露两个独立开关**：cleanup on/off、translate on/off | 用户感知保留"独立性"，工程实现是 prompt 变体而非 stage 拆分 |
| 6 | **词典处理**：原字 + 括号译名，每次出现都加 | 一致性优先；C 方案"区分词条类别"需 schema 扩展，留待 v2 |
| 7 | **历史 schema**：transcriptions 表加 `raw_text TEXT NULL` | 不引入 metadata JSON 列，保持最小改动 |
| 8 | **失败回退**：粘贴原文 + tray/toast 提示"翻译失败已回退原文" | 既不丢内容也告知用户，避免静默 fallback 造成意外 |
| 9 | **Prompt 协同**：`{{TARGET_LANG_INSTRUCTION}}` 占位符注入，缺失时 fallback 到末尾追加 | 高级用户可精确控制注入位置；老用户 prompt 不破坏 |
| 10 | **PromptStudio 显性 banner**：翻译 ON 时显示提示、示例、"插入占位符到光标"按钮 | 显性教育用户怎么使用占位符 |
| 11 | **HistoryView 默认折叠原文**：`<details>` 折叠，最终文本主显示 | 视觉简洁，老用户 UI 不膨胀，翻译用户一键展开 |
| 12 | **"已是目标语言"判断完全交给 LLM** | 启发式语言识别在短/混合文本上不可靠；多花的判断 token 远小于错判代价 |
| 13 | **翻译默认 OFF**；UI 防御"开关 ON 但目标语言未选"的状态 | 避免老用户更新后输出突变 |
| 14 | **terminology profile 同 dictionary 处理**：preferred/glossary 走括号译名，blacklist/homophone 不入翻译规则 | blacklist/homophone 语义在跨语言场景下模糊，cleanup 阶段已经处理完 |

---

## 2. 管道与数据流

```
[Hotkey 按下]
   │
   ▼
[录音 + Whisper / Parakeet / 云端 ASR 转录]
   │
   ▼
[原始转录文本 raw_text]
   │
   ├─→ cleanup 与 translate 均关闭 → 直接进入「粘贴」（跳过 reasoning）
   │
   ▼
[ReasoningService.processText(raw_text, model, config)]
   │   ↓ system prompt 构造逻辑：
   │     1. 取 cleanup prompt（用户自定义 || 系统预设）
   │     2. 翻译开关 ON：
   │        - 含 {{TARGET_LANG_INSTRUCTION}} → 占位符替换为翻译指令块
   │        - 不含占位符 → 末尾追加翻译指令块
   │     3. 翻译开 + 词典非空：
   │        - 含 {{DICTIONARY_TRANSLATION_RULE}} → 占位符替换为词典括号译名规则块
   │        - 不含占位符 → 末尾追加词典括号译名规则块
   │     4. 词典注入 + terminology profile 注入（沿用现有逻辑）
   │
   ▼
[final_text]
   │
   ├─→ 调用成功 → 粘贴 final_text；DB 存 { raw_text, text: final_text }
   │
   └─→ 调用失败（超时/网络/quota/API 错误）
       → 粘贴 raw_text + tray toast "翻译失败已回退原文"
       → DB 存 { raw_text, text: raw_text }
       → logger.logReasoning("TRANSLATION_FALLBACK_TO_RAW", { error })
```

**核心约束**：

- 整条管道**只有一次** LLM 调用。翻译表现为 cleanup prompt 的一种变体，不引入独立 stage。
- `audioManager.processWithReasoningModel(text, model, config)` 和 `ReasoningService.processText(...)` 的接口签名不变。
- 4 个 reasoning provider（OpenAI / Anthropic / Gemini / Local）的实现完全不动 —— 翻译能力对它们透明。
- DB schema 新增 `raw_text TEXT NULL` 一列；老数据 `raw_text` 为 NULL，视为"未记录原文"，UI 不显示折叠器。

---

## 3. UI 三处改造

### 3.1 SettingsPage — 翻译设置组

放在 "AI 文本清理" 区块**正下方**，逻辑相邻。

```
┌─ AI 文本清理 ────────────────────┐
│  [开关] 启用 AI 文本清理         │
│  Provider: [OpenAI ▾]            │
│  模型:    [GPT-5 Mini ▾]         │
└──────────────────────────────────┘

┌─ AI 翻译输出 ────────────────────┐  ← 新增区块
│  [开关] 开启后将转录结果统一翻译  │
│         为目标语言               │
│  目标语言: [English ▾]           │  ← 复用 src/utils/languages.ts 58 种语言
│                                  │
│  ℹ 翻译与 cleanup 共用同一个     │
│    provider / 模型，合并为一次   │
│    LLM 调用。                    │
└──────────────────────────────────┘
```

**UI 防御**：

- 翻译开关默认 OFF；目标语言初值 `""`。
- 开关 toggle ON 时若目标语言为 `""`，弹 confirm 强制选择，选完才能 toggle on；或开关初始 disabled，目标语言选好后变 enabled。
- 运行时（`audioManager`）兜底：`translationEnabled && !translationTargetLang` → 当作翻译未开 + logger.warn。
- 目标语言列表使用 `src/utils/languages.ts` 中除 `auto` 外的所有语言（`auto` 作为目标无意义）。

### 3.2 PromptStudio — 翻译开启时的显性 Banner

翻译开关 ON 时显示，OFF 时完全隐藏（不打扰）。

```
┌─ Prompt 编辑器 ──────────────────────────────────┐
│ ⓘ 翻译已开启 → 目标语言：English                │
│                                                  │
│   规则会自动插入到你 prompt 中的占位符位置：    │
│        {{TARGET_LANG_INSTRUCTION}}              │
│                                                  │
│   未包含占位符时，规则将追加到 prompt 末尾。    │
│                                                  │
│   示例：                                         │
│   ┌────────────────────────────────────────────┐│
│   │ 请把口语化转录整理成正式书面语。           ││
│   │ {{TARGET_LANG_INSTRUCTION}}                ││
│   │ 不要改变原意，保留专有名词的原写法。       ││
│   └────────────────────────────────────────────┘│
│                                                  │
│   [插入占位符到光标位置]                         │
└──────────────────────────────────────────────────┘
```

### 3.3 HistoryView — 每行折叠原文

```
┌────────────────────────────────────────┐
│ 2026-05-22 14:30                       │
│                                        │
│ Mouthpiece (口器) growth on 小红书     │  ← 主显示：最终文本
│ (Xiaohongshu) is good.                 │
│                                        │
│ ▸ 查看原文 (转录原稿)                  │  ← <details> 折叠器
│   └─ 小红书的 Mouthpiece 增长不错      │  ← 展开后显示
│                                        │
│ [复制最终]  [复制原文]  [删除]         │
└────────────────────────────────────────┘
```

- 仅 `raw_text` 非 NULL 时显示折叠器（老数据隐藏）。
- 默认折叠状态，用户点击展开。

---

## 4. 数据 / 状态 / 边界

### 4.1 DB schema 改造

```sql
ALTER TABLE transcriptions ADD COLUMN raw_text TEXT;
```

- 通过 `src/helpers/database.js` 中现有 migration 机制在启动时执行。
- 老数据 `raw_text = NULL`；新数据 `raw_text` 始终非 NULL（即使 cleanup 和 translate 都关，也存原文 = 最终文本）。

### 4.2 Settings 存储（localStorage）

```ts
translationEnabled: boolean       // 默认 false
translationTargetLang: string     // 语言代码（如 "en"），默认 ""
```

- 不需要单独的 provider/model key。
- 不需要 metadata 字段。

### 4.3 terminology profile 在翻译开启时的行为

| 字段 | cleanup 阶段（不变） | 翻译开启时新增行为 |
|---|---|---|
| `preferredTerms` | 提示 LLM 优先使用这些术语 | 走括号译名规则（同 dictionary） |
| `glossaryTerms` | 提示 LLM 优先使用这些术语 | 走括号译名规则（同 dictionary） |
| `blacklistedTerms` | 提示 LLM 避免使用 | **不进入翻译规则**（cleanup 阶段已处理完） |
| `homophoneMappings` | 提示 LLM 音近词归一 | **不进入翻译规则**（cleanup 阶段已处理完） |

### 4.4 "已是目标语言"的判断

完全交给 LLM。prompt 中明确告诉模型三种分支：

1. 原文 = 目标语言：只做 cleanup，原样输出
2. 原文 ≠ 目标语言：cleanup 后翻译到目标
3. 原文为多语言混合：cleanup 后统一翻译到目标

**不在代码里做客户端的语言识别启发式**，理由：

- 短文本/混合语言下识别准确率 60% 以下
- LLM 看完整上下文判断比启发式稳得多
- 多花的判断 token 远小于错判代价

如未来真实使用中观察到 LLM 偶尔"过度热心"重写英文，可在 v2 加一个客户端启发式开关，但 v1 不做。

---

## 5. Prompt 建议方向（模板文案由用户提供）

设计文档不规定具体 prompt 文案。用户会自行编写优化版本。但模板**至少应覆盖 5 块语义**：

1. **任务声明**：明确"语音转录后的整理 + 输出语言统一"，不是摘要或改写
2. **输出语言锁定**：`输出语言 = {{TARGET_LANG}}`，明确"无论输入是什么语言"
3. **"已是目标语言"分支**：明确"若原文已是 {{TARGET_LANG}}，只做 cleanup，不重写"——这一句是防止 LLM 把英文重写一遍的关键
4. **混合语言处理**：明确"若原文为多语言混合，统一翻译到 {{TARGET_LANG}}"
5. **词典词处理规则**：词典词在输出中保留原写法 + 紧跟括号附加 {{TARGET_LANG}} 译名，每次出现都加

### 5.1 推荐的两个占位符

```
{{TARGET_LANG_INSTRUCTION}}      ← 翻译开启时注入"输出语言锁定 + 三分支判断"
{{DICTIONARY_TRANSLATION_RULE}}  ← 翻译开启且词典非空时注入"词典括号译名规则"
```

分开管理的好处：词典为空时第二个块不渲染，避免 LLM 看到"按规则处理词典"但词典为空的孤儿指令。

### 5.2 注入逻辑（伪代码）

```ts
function buildSystemPrompt(userPromptOrPreset, settings) {
  let prompt = userPromptOrPreset;

  const targetLangBlock = settings.translationEnabled
    ? renderTargetLangBlock(settings.translationTargetLang)
    : "";

  const dictRuleBlock =
    settings.translationEnabled && settings.customDictionary.length > 0
      ? renderDictTranslationRuleBlock(settings.translationTargetLang)
      : "";

  prompt = injectOrAppend(prompt, "{{TARGET_LANG_INSTRUCTION}}", targetLangBlock);
  prompt = injectOrAppend(prompt, "{{DICTIONARY_TRANSLATION_RULE}}", dictRuleBlock);

  // 沿用现状：dictionary 列表注入、terminology profile 注入
  return prompt;
}

function injectOrAppend(prompt, placeholder, block) {
  if (!block) {
    // 翻译未开或词典空 → 占位符若存在则清空，避免暴露给 LLM
    return prompt.replaceAll(placeholder, "");
  }
  if (prompt.includes(placeholder)) {
    return prompt.replaceAll(placeholder, block);
  }
  return prompt + "\n\n" + block;
}
```

---

## 6. 实施阶段（6 阶段 / Implementation phases）

每阶段可独立验证、独立提交。详细的文件级改动顺序由 `superpowers:writing-plans` skill 在 worktree 中产出 plan 文档。

| 阶段 | 内容 | 主要验证 |
|---|---|---|
| **P1. 数据层** | `transcriptions` 表 `ADD COLUMN raw_text`；settings 加 `translationEnabled` / `translationTargetLang` 两个 key | 启动后查 schema；改 localStorage 后重启读到值 |
| **P2. SettingsPage UI** | 翻译设置组（开关 + 目标语言 dropdown）；开关防御逻辑 | 手工：开关切换、未选目标语言时阻止 |
| **P3. Prompt 注入引擎** | `getSystemPrompt()` 扩展占位符替换/末尾追加；新增 `renderTargetLangBlock` / `renderDictTranslationRuleBlock`（**模板文案由用户提供**） | 单元测试：4 种组合（开关 on/off × 占位符 有/无）的输出 prompt 字符串快照 |
| **P4. PromptStudio Banner** | 翻译 ON 时显示提示 banner + 示例 + "插入占位符到光标"按钮 | 手工：翻译开/关时 banner 显示/隐藏 |
| **P5. HistoryView 折叠** | DB 读取 `raw_text`；最终文本主显示，原文 `<details>` 折叠（仅 `raw_text` 非 NULL 时显示折叠器） | 手工：老数据无折叠器，新数据可展开 |
| **P6. 错误回退 + Toast** | `audioManager.processWithReasoningModel` catch 后粘贴原文 + 触发 tray/系统 toast | 手工：断网模拟、API key 错时验证 |

---

## 7. 测试 / i18n / 上线

### 7.1 测试

沿用现有 `tests/` 基建（`node --test`）。

- **单元测试**：
  - prompt 注入 4 种组合：翻译开/关 × 占位符 存在/不存在
  - 词典规则块的注入条件（仅翻译开且词典非空）
- **集成测试**：
  - OpenAI / Anthropic / Gemini / Local 4 个 provider 均跑一次"含翻译"的 reasoning，确认请求体里 system prompt 正确
- **手工 smoke**：
  1. 中文输入 + 目标英语 → 输出英文译文
  2. 英文输入 + 目标英语 → 输出 cleanup 后英文（不重写）
  3. 中英混合输入 + 目标英语 → 统一英文输出
  4. 翻译失败（断网模拟）→ 粘贴原文 + toast 提示

### 7.2 i18n

新 UI 文案（设置组标题与说明、Banner 文案、HistoryView "原文 / 最终" 标签、Toast 文案）需要在 `src/locales/` 下所有语言文件添加 key：`en`、`es`、`fr`、`de`、`pt`、`it`、`ru`、`ja`、`zh-CN`、`zh-TW`。

### 7.3 CHANGELOG

按 CLAUDE.md 规范，在 `[Unreleased]` 加：

```
Added: AI translation output that unifies multilingual dictation into a single target language.
       Cleanup + translation run in a single LLM call; toggle in Settings, target language picker,
       custom-dictionary terms preserved with parenthesized translations.
```

### 7.4 Git worktree

按 CLAUDE.md 规范，实施前已确认在 worktree 中工作（`ai-translation-output`）。

---

## 8. 已知风险与权衡

| 风险 | 缓解 |
|---|---|
| LLM 把已是目标语言的文本"过度热心"地重写 | prompt 第 3 块"已是目标语言"分支明确"不重写"；如真实使用中观察到问题，v2 加客户端启发式 |
| 词典词每次都加括号导致长段译文啰嗦 | 用户已知此 trade-off；如反馈强烈，v2 改为"首次加 + 后续不加"或按词条类别分流 |
| 用户自定义 prompt 与翻译指令措辞冲突（例如自定义 prompt 说"保持原语言"） | PromptStudio banner 提示用户翻译开启时的行为约束；不在代码里硬管 |
| 翻译延迟比纯 cleanup 略长（同一调用但 prompt 更长 + 输出可能更长） | 选 B 方案已经把多调用代价压成 prompt 长度代价；若云端模型延迟可接受范围内不进一步优化 |
| 老用户 HistoryView 升级后多出折叠器 | 仅 `raw_text` 非 NULL 时显示折叠器，老数据完全保持原样 |

---

## 9. v2 候选（明确不在 v1 范围）

- 多目标语言切换器（按 App / hotkey）
- 双语对照输出
- 词典支持"目标语言译名"字段（替代括号译名）
- 词典支持"类别"字段（品牌/人名/地名）以做差异化处理
- 翻译单独配置 provider / model
- 历史记录"重做翻译到另一种语言"
- 客户端"已是目标语言"启发式（在 LLM 偶发不当重写时启用）
