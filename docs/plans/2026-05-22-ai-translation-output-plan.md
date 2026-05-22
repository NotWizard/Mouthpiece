# AI 翻译输出 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** 在现有"转录 → cleanup → 粘贴"管道之上新增"AI 翻译输出"能力：开启后将（可能是混合语言的）转录文本与 cleanup 合并为**一次** LLM 调用，统一输出为用户配置的目标语言；翻译失败时回退到原文 + tray toast 提示。

**Architecture:** 翻译完全表现为 `ReasoningService` 的 system prompt 变体——不引入新的 reasoning service、不引入新的 stage、对 4 个 reasoning provider（OpenAI/Anthropic/Gemini/Local）零侵入。新增 2 个 prompt 占位符 `{{TARGET_LANG_INSTRUCTION}}` 与 `{{DICTIONARY_TRANSLATION_RULE}}`，含占位符时替换、不含时末尾追加。`transcriptions` 表加 `raw_text` 列以支持 HistoryView 折叠展示原文。

**Tech Stack:** Electron 36, React 19, TypeScript, Zustand, better-sqlite3, node `node:test`, react-i18next, Tailwind CSS v4

**Worktree:** This plan is executed inside the worktree at `/Users/xxx/Downloads/Projects/AICode/Mouthpiece/.worktrees/ai-translation-output`. The branch is `ai-translation-output`, based on `main` HEAD `75d78c6` (baseline 修复 + 设计文档). Baseline test suite: **400 tests / 400 pass / 0 fail / 0 skipped** (`node --test tests/*.test.mjs tests/*.test.cjs`).

**Design source of truth:** `docs/plans/2026-05-22-ai-translation-output-design.md` — review before starting and consult for any ambiguity. The 14 locked decisions in that doc override conflicting choices below.

**Prompt templates:** The actual prompt text for `renderTargetLangBlock` and `renderDictTranslationRuleBlock` is supplied by the user. Task T3.2 leaves these as `TODO_PROMPT_TEXT` placeholders; before commit the user must paste the final prompt strings in. **Do not invent prompt text.**

**Convention for every commit:** Bilingual subject + body following `CLAUDE.md` "Git Commit Messages" rules (Chinese block first, English block second, plain text only). Each task in this plan = one git commit unless explicitly noted.

**CHANGELOG:** All user-visible behavior changes must update `CHANGELOG.md` under `[Unreleased]` in the same commit. Phases P1, P6 do not touch CHANGELOG (internal plumbing). Phases P2, P4, P5 do.

---

## Baseline Verification

Before starting any task, confirm the worktree is clean and tests are green.

```bash
cd /Users/xxx/Downloads/Projects/AICode/Mouthpiece/.worktrees/ai-translation-output
git status -sb                                                          # expect: ## ai-translation-output
node --test tests/*.test.mjs tests/*.test.cjs 2>&1 | grep -E "^ℹ"     # expect: tests 400 / pass 400 / fail 0
```

If any failure exists, do NOT proceed — investigate and report.

---

## Phase 1 — Data Layer (no user-visible change)

### Task 1.1: Add `raw_text` column migration to transcriptions table

**Files:**
- Modify: `src/helpers/database.js:23-30` (CREATE TABLE + add ALTER migration)

**Step 1: Write the failing test**

Create `tests/transcriptions-raw-text-column.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("database.js declares raw_text column and an ALTER TABLE migration for legacy DBs", async () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/helpers/database.js"),
    "utf8"
  );

  // CREATE TABLE must include raw_text
  assert.match(
    source,
    /CREATE TABLE IF NOT EXISTS transcriptions[\s\S]*raw_text TEXT/,
    "transcriptions CREATE TABLE must declare raw_text TEXT column"
  );

  // Migration block must add raw_text to existing DBs (idempotent)
  assert.match(
    source,
    /ALTER TABLE transcriptions ADD COLUMN raw_text TEXT/,
    "database.js must contain ALTER TABLE migration for legacy DBs"
  );
});
```

**Step 2: Run the test and confirm it fails**

```bash
node --test tests/transcriptions-raw-text-column.test.mjs
```

Expected: FAIL with two assertion failures.

**Step 3: Implement migration in `src/helpers/database.js`**

In `initDatabase()`, update the `CREATE TABLE` SQL and add a migration block after the existing CREATE TABLE statements:

```javascript
this.db.exec(`
  CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    raw_text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Idempotent migration for DBs created before raw_text existed.
// PRAGMA table_info is the standard way to check column existence in SQLite.
try {
  const columns = this.db.prepare("PRAGMA table_info(transcriptions)").all();
  const hasRawText = columns.some((c) => c.name === "raw_text");
  if (!hasRawText) {
    this.db.exec("ALTER TABLE transcriptions ADD COLUMN raw_text TEXT");
  }
} catch (error) {
  debugLogger.error(
    "raw_text migration failed",
    { error: error.message },
    "database"
  );
}
```

**Step 4: Run the test, confirm pass**

```bash
node --test tests/transcriptions-raw-text-column.test.mjs
```

Expected: PASS (1 test).

**Step 5: Commit**

```bash
git add tests/transcriptions-raw-text-column.test.mjs src/helpers/database.js
git commit -m "$(cat <<'EOF'
为转录历史添加 raw_text 列与迁移 / Add raw_text column and migration to transcriptions

中文
  概述：transcriptions 表加 raw_text 列，存放 cleanup/translate 之前的转录原稿；
  对老库幂等执行 ALTER TABLE 兼容迁移。
  变更：
    1. CREATE TABLE 声明 raw_text TEXT。
    2. PRAGMA table_info 探测后按需 ALTER TABLE。
    3. 新增 tests/transcriptions-raw-text-column.test.mjs 守护字段与迁移。
  验证：
    1. node --test tests/transcriptions-raw-text-column.test.mjs:1 pass。
English
  Summary: Add raw_text column to transcriptions and an idempotent ALTER TABLE
  migration for legacy databases. The column stores the raw transcript prior
  to cleanup/translate.
  Changes:
    1. CREATE TABLE now declares raw_text TEXT.
    2. PRAGMA table_info detection + conditional ALTER TABLE.
    3. New tests/transcriptions-raw-text-column.test.mjs guards both.
  Verification:
    1. node --test tests/transcriptions-raw-text-column.test.mjs: 1 pass.
EOF
)"
```

---

### Task 1.2: Extend `saveTranscription` to accept raw_text

**Files:**
- Modify: `src/helpers/database.js:47-63`
- Modify: `src/helpers/ipcHandlers.js:377-385` (handler signature)
- Modify: `preload.js:59` (IPC bridge)
- Modify: `src/types/electron.ts:5-10` (TranscriptionItem type) and `:396` (saveTranscription signature)

**Step 1: Write the failing test**

Create `tests/save-transcription-raw-text.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

test("saveTranscription accepts optional rawText and persists it", () => {
  const dbSource = read("src/helpers/database.js");
  assert.match(
    dbSource,
    /saveTranscription\(text,\s*rawText\)/,
    "database.js saveTranscription must accept rawText parameter"
  );
  assert.match(
    dbSource,
    /INSERT INTO transcriptions \(text,\s*raw_text\)/,
    "INSERT must include raw_text column"
  );
});

test("IPC db-save-transcription forwards rawText", () => {
  const source = read("src/helpers/ipcHandlers.js");
  assert.match(
    source,
    /ipcMain\.handle\("db-save-transcription",\s*async\s*\(event,\s*text,\s*rawText\)/
  );
  assert.match(source, /this\.databaseManager\.saveTranscription\(text,\s*rawText\)/);
});

test("preload exposes saveTranscription with rawText", () => {
  const source = read("preload.js");
  assert.match(
    source,
    /saveTranscription:\s*\(text,\s*rawText\)\s*=>\s*ipcRenderer\.invoke\("db-save-transcription",\s*text,\s*rawText\)/
  );
});

test("TranscriptionItem type and saveTranscription signature include raw_text / rawText", () => {
  const source = read("src/types/electron.ts");
  assert.match(source, /raw_text\?:\s*string\s*\|\s*null/);
  assert.match(
    source,
    /saveTranscription:\s*\(text:\s*string,\s*rawText\?:\s*string\s*\|\s*null\)\s*=>\s*Promise<\{\s*id:\s*number;\s*success:\s*boolean\s*\}>/
  );
});
```

**Step 2: Run the test, confirm FAIL** with 4 assertion failures.

```bash
node --test tests/save-transcription-raw-text.test.mjs
```

**Step 3: Implement changes**

In `src/helpers/database.js` (around line 47):

```javascript
saveTranscription(text, rawText) {
  try {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    const stmt = this.db.prepare(
      "INSERT INTO transcriptions (text, raw_text) VALUES (?, ?)"
    );
    const result = stmt.run(text, rawText ?? null);

    const fetchStmt = this.db.prepare("SELECT * FROM transcriptions WHERE id = ?");
    const transcription = fetchStmt.get(result.lastInsertRowid);

    return { id: result.lastInsertRowid, success: true, transcription };
  } catch (error) {
    debugLogger.error("Error saving transcription", { error: error.message }, "database");
    throw error;
  }
}
```

In `src/helpers/ipcHandlers.js` (around line 377):

```javascript
ipcMain.handle("db-save-transcription", async (event, text, rawText) => {
  const result = this.databaseManager.saveTranscription(text, rawText);
  if (result?.success && result?.transcription) {
    setImmediate(() => {
      this.broadcastToWindows("transcription-added", result.transcription);
    });
  }
  return result;
});
```

In `preload.js` (line 59):

```javascript
saveTranscription: (text, rawText) =>
  ipcRenderer.invoke("db-save-transcription", text, rawText),
```

In `src/types/electron.ts` (around line 5-10):

```typescript
export interface TranscriptionItem {
  id: number;
  text: string;
  raw_text?: string | null;
  timestamp: string;
  created_at: string;
}
```

And (around line 396) update the API surface declaration:

```typescript
saveTranscription: (
  text: string,
  rawText?: string | null
) => Promise<{ id: number; success: boolean }>;
```

**Step 4: Run the test, confirm PASS** (4 tests).

```bash
node --test tests/save-transcription-raw-text.test.mjs
```

**Step 5: Commit**

```bash
git add tests/save-transcription-raw-text.test.mjs src/helpers/database.js src/helpers/ipcHandlers.js preload.js src/types/electron.ts
git commit -m "$(cat <<'EOF'
saveTranscription 接收 rawText 透传到数据库 / Thread rawText through saveTranscription IPC

中文
  概述：扩展 saveTranscription 链路（database → IPC → preload → types）支持透传
  rawText；老调用方传 undefined 时与之前行为完全等价（rawText 入库为 NULL）。
  变更：
    1. DatabaseManager.saveTranscription(text, rawText) INSERT 含 raw_text 列。
    2. IPC handler db-save-transcription 多接一个参数。
    3. preload bridge 与 TS 类型同步扩展（rawText 可选）。
    4. TranscriptionItem 类型加 raw_text?: string | null。
  验证：
    1. node --test tests/save-transcription-raw-text.test.mjs:4 pass。
English
  Summary: Thread rawText through the saveTranscription chain (database → IPC →
  preload → types). Legacy call sites passing undefined produce the same behavior
  as before (raw_text persisted as NULL).
  Changes:
    1. DatabaseManager.saveTranscription(text, rawText) INSERT includes raw_text.
    2. IPC handler db-save-transcription gets an extra parameter.
    3. preload bridge + TS types updated (rawText optional).
    4. TranscriptionItem type gains raw_text?: string | null.
  Verification:
    1. node --test tests/save-transcription-raw-text.test.mjs: 4 pass.
EOF
)"
```

---

### Task 1.3: Pass raw + final text through `processTranscription`

**Files:**
- Modify: `src/helpers/audioManager.js:2190-2274` (`processTranscription` returns `{ finalText, rawText, fallbackReason? }`)
- Modify: `src/helpers/audioManager.js:3512-3517` (`saveTranscription` forwards rawText)
- Modify: `src/hooks/useAudioRecording.js:603` (call site)
- Search for ALL OTHER `processTranscription` callers (greps below) and adjust.

**Step 1: Identify caller sites**

```bash
grep -n "this\.processTranscription\(\|processTranscription\s*(" src/helpers/audioManager.js
```

Expected sites (approx): around `1567`, `1640`, `1720`, `2734`, `2850`, `3130`, `3211`, `4086`, `4106`. Each call receives a plain string. After this task they will receive a `{ finalText, rawText }` object — adjust each call site to unwrap `finalText` before assigning to local `text` (and stash `rawText` for the downstream save).

**Step 2: Write the failing test**

Create `tests/audio-manager-raw-text-flow.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/helpers/audioManager.js"),
  "utf8"
);

test("processTranscription returns an object containing finalText and rawText", () => {
  assert.match(
    source,
    /async\s+processTranscription\(text,\s*source\)\s*\{[\s\S]*?return\s*\{[\s\S]*?finalText[\s\S]*?rawText/,
    "processTranscription must return { finalText, rawText, ... }"
  );
});

test("saveTranscription forwards rawText to electronAPI", () => {
  assert.match(
    source,
    /async\s+saveTranscription\(text,\s*rawText\)\s*\{[\s\S]*?window\.electronAPI\.saveTranscription\(text,\s*rawText\)/
  );
});
```

**Step 3: Confirm FAIL**

```bash
node --test tests/audio-manager-raw-text-flow.test.mjs
```

**Step 4: Implement**

In `src/helpers/audioManager.js`:

- Change `processTranscription(text, source)` so that the **single source of truth** for raw transcript is `normalizedText` (the trimmed input), and the return shape becomes:
  - On success: `{ finalText: resultFromReasoning, rawText: normalizedText, fallbackReason: null }`
  - On reasoning-skipped paths (no reasoning model, empty text, sensitive app block): `{ finalText: normalizedText, rawText: normalizedText, fallbackReason: null }` (set `rawText: null` only when empty input — otherwise raw == final, which is fine; HistoryView will hide the folder when they're equal — see Task 5.1)
  - On reasoning failure caught by the existing try/catch around `processWithReasoningModel`: `{ finalText: normalizedText, rawText: normalizedText, fallbackReason: "reasoning_failed" }` (Phase 6 will use `fallbackReason` to trigger toast)

- Change `saveTranscription(text, rawText)`:

```javascript
async saveTranscription(text, rawText) {
  try {
    await window.electronAPI.saveTranscription(text, rawText ?? null);
    return true;
  } catch (error) {
    return false;
  }
}
```

- For every caller of `processTranscription` (use the grep from Step 1), unwrap:

```javascript
const { finalText, rawText, fallbackReason } = await this.processTranscription(result.text, "local");
const text = finalText;
this._lastRawText = rawText;        // stash on instance for saveTranscription
this._lastFallbackReason = fallbackReason; // used by Phase 6
```

In `src/hooks/useAudioRecording.js` line 603, change:

```javascript
audioManagerRef.current.saveTranscription(
  result.text,
  audioManagerRef.current._lastRawText ?? null
);
```

**Step 5: Confirm PASS**

```bash
node --test tests/audio-manager-raw-text-flow.test.mjs
```

Then run the broader baseline to ensure no regression in the 9 caller sites:

```bash
node --test tests/*.test.mjs tests/*.test.cjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```

Expected: `tests 402 / pass 402 / fail 0` (400 existing + 1 from Task 1.1 + 1 from Task 1.3's new test file's 2 tests = 403; if the math differs by 1, re-check the suite output — none should newly fail).

**Step 6: Commit**

```bash
git add tests/audio-manager-raw-text-flow.test.mjs src/helpers/audioManager.js src/hooks/useAudioRecording.js
git commit -m "$(cat <<'EOF'
processTranscription 返回 raw 与 final 两份文本 / Return raw and final text from processTranscription

中文
  概述：让 processTranscription 同时返回原始转录文本与 reasoning 最终结果,
  audioManager.saveTranscription 同步透传 rawText 入库,为 HistoryView 展开
  原文与翻译失败回退提示提供基础。
  变更：
    1. processTranscription 返回 { finalText, rawText, fallbackReason? }。
    2. saveTranscription(text, rawText) 透传到 electronAPI。
    3. 9 处现有调用者解构使用 finalText,并在实例上 stash rawText。
    4. useAudioRecording 调用 saveTranscription 时传 audioManager._lastRawText。
  验证：
    1. node --test tests/audio-manager-raw-text-flow.test.mjs:2 pass。
    2. 完整 baseline:无新增失败。
English
  Summary: processTranscription now returns both the raw transcript and the
  reasoning-final text. audioManager.saveTranscription threads rawText through
  to the DB. This is the plumbing for HistoryView raw-text disclosure and the
  translation-fallback toast in later phases.
  Changes:
    1. processTranscription returns { finalText, rawText, fallbackReason? }.
    2. saveTranscription(text, rawText) forwards through electronAPI.
    3. All 9 existing callers destructure finalText and stash rawText on the
       audioManager instance.
    4. useAudioRecording passes audioManager._lastRawText when saving.
  Verification:
    1. node --test tests/audio-manager-raw-text-flow.test.mjs: 2 pass.
    2. Full baseline: no new failures.
EOF
)"
```

---

## Phase 2 — Settings Layer

### Task 2.1: Add `translationEnabled` and `translationTargetLang` settings

**Files:**
- Modify: `src/hooks/useSettings.ts` — extend `ReasoningSettings` interface and `useSettingsInternal` return object
- Modify: `src/stores/settingsStore.ts` — add initial values, setters, and `BOOLEAN_SETTINGS` membership

**Step 1: Write the failing test**

Create `tests/translation-settings-store.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const settingsStore = fs.readFileSync(path.join(repoRoot, "src/stores/settingsStore.ts"), "utf8");
const useSettings = fs.readFileSync(path.join(repoRoot, "src/hooks/useSettings.ts"), "utf8");

test("ReasoningSettings interface declares translation toggles", () => {
  assert.match(useSettings, /translationEnabled:\s*boolean/);
  assert.match(useSettings, /translationTargetLang:\s*string/);
});

test("settingsStore initializes translation settings with safe defaults", () => {
  assert.match(
    settingsStore,
    /translationEnabled:\s*readBoolean\("translationEnabled",\s*false\)/,
    "translationEnabled must default to false"
  );
  assert.match(
    settingsStore,
    /translationTargetLang:\s*readString\("translationTargetLang",\s*""\)/,
    'translationTargetLang must default to "" (forces explicit pick)'
  );
});

test("settingsStore exposes setters and registers boolean key", () => {
  assert.match(settingsStore, /setTranslationEnabled:\s*createBooleanSetter\("translationEnabled"\)/);
  assert.match(settingsStore, /setTranslationTargetLang:\s*createStringSetter\("translationTargetLang"\)/);
  assert.match(
    settingsStore,
    /BOOLEAN_SETTINGS\s*=\s*new\s+Set\(\[[\s\S]*?"translationEnabled"/,
    "translationEnabled must be in BOOLEAN_SETTINGS for persistence"
  );
});
```

**Step 2: Run and confirm FAIL.**

**Step 3: Implement.** Add to `src/hooks/useSettings.ts` `ReasoningSettings` interface (around line 30-38):

```typescript
export interface ReasoningSettings {
  useReasoningModel: boolean;
  reasoningModel: string;
  reasoningProvider: string;
  cloudReasoningBaseUrl?: string;
  cloudReasoningMode: string;
  bailianReasoningEnableThinking: boolean;
  customReasoningEnableThinking: boolean;
  translationEnabled: boolean;
  translationTargetLang: string;
}
```

Then export both fields in the `useSettingsInternal` return object and matching `set*` functions (mirror the pattern used by `useReasoningModel` / `setUseReasoningModel`).

In `src/stores/settingsStore.ts`:

- Add `"translationEnabled"` to `BOOLEAN_SETTINGS` (around line 195-213).
- Add interface members (around line 230-297) mirroring `useReasoningModel`/`setUseReasoningModel`:
  ```typescript
  setTranslationEnabled: (value: boolean) => void;
  setTranslationTargetLang: (value: string) => void;
  ```
- Add initial values to the state object (around line 470-472):
  ```typescript
  translationEnabled: readBoolean("translationEnabled", false),
  translationTargetLang: readString("translationTargetLang", ""),
  ```
- Add setters (around line 525-528):
  ```typescript
  setTranslationEnabled: createBooleanSetter("translationEnabled"),
  setTranslationTargetLang: createStringSetter("translationTargetLang"),
  ```

**Step 4: Run and confirm PASS** (3 tests).

**Step 5: Commit**

```bash
git add tests/translation-settings-store.test.mjs src/hooks/useSettings.ts src/stores/settingsStore.ts
git commit -m "$(cat <<'EOF'
新增翻译开关与目标语言设置 / Add translation toggle and target language settings

中文
  概述：在 settings store 与 useSettings 接口中加入 translationEnabled 与
  translationTargetLang;默认关闭,目标语言空串强制用户显式选择。
  变更：
    1. ReasoningSettings 接口与 useSettings 返回对象同步扩展。
    2. settingsStore 加初始值/setter/BOOLEAN_SETTINGS 注册。
  验证：
    1. node --test tests/translation-settings-store.test.mjs:3 pass。
English
  Summary: Add translationEnabled and translationTargetLang to the settings
  store and useSettings interface. Translation is off by default and the
  target language defaults to empty (forces an explicit pick).
  Changes:
    1. ReasoningSettings interface + useSettings return object expanded.
    2. settingsStore initial values, setters, and BOOLEAN_SETTINGS membership.
  Verification:
    1. node --test tests/translation-settings-store.test.mjs: 3 pass.
EOF
)"
```

---

### Task 2.2: Add i18n keys for the new Settings section (10 locales)

**Files:**
- Modify: `src/locales/en/translation.json`
- Modify: `src/locales/{es,fr,de,pt,it,ru,ja,zh-CN,zh-TW}/translation.json`

**Step 1: Write the failing test**

Create `tests/translation-i18n-keys.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const LOCALES = ["en", "es", "fr", "de", "pt", "it", "ru", "ja", "zh-CN", "zh-TW"];
const REQUIRED_KEYS = [
  "settingsPage.aiTranslation.title",
  "settingsPage.aiTranslation.description",
  "settingsPage.aiTranslation.enableLabel",
  "settingsPage.aiTranslation.enableDescription",
  "settingsPage.aiTranslation.targetLangLabel",
  "settingsPage.aiTranslation.targetLangDescription",
  "settingsPage.aiTranslation.providerNote",
  "settingsPage.aiTranslation.requireTargetLang",
];

function get(obj, dotted) {
  return dotted.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

for (const locale of LOCALES) {
  test(`locale ${locale} declares all translation i18n keys`, () => {
    const filePath = path.resolve(process.cwd(), `src/locales/${locale}/translation.json`);
    const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
    for (const key of REQUIRED_KEYS) {
      const value = get(json, key);
      assert.equal(typeof value, "string", `${locale}: ${key} missing or not string`);
      assert.ok(value.length > 0, `${locale}: ${key} empty`);
    }
  });
}
```

**Step 2: Run and confirm FAIL** (10 tests fail).

**Step 3: Implement.** Add the following block to **each** of the 10 locale files under the existing `settingsPage` object. Use `en/translation.json` as the canonical version; translate strings into the target language for the others. Keep `{{lang}}` placeholders verbatim.

English (`en/translation.json`):

```json
"aiTranslation": {
  "title": "AI Translation Output",
  "description": "Unify multilingual dictation into a single target language. Combined into one LLM call with cleanup.",
  "enableLabel": "Translate output to target language",
  "enableDescription": "When enabled, cleanup and translation share the same provider/model in a single LLM call.",
  "targetLangLabel": "Target language",
  "targetLangDescription": "All transcripts are unified into this language. If the input is already in this language, only cleanup runs.",
  "providerNote": "Translation uses the same provider and model as cleanup (a single LLM call). Failures fall back to the raw transcript with a notice.",
  "requireTargetLang": "Please pick a target language before enabling translation."
}
```

Translate to each of `es, fr, de, pt, it, ru, ja, zh-CN, zh-TW` — use natural translations. Examples:

- `zh-CN` (`title`): `"AI 翻译输出"`, (`description`): `"把多语言听写统一翻译成单一目标语言。与文本清理合并成一次 LLM 调用。"`
- `ja` (`title`): `"AI 翻訳出力"`, (`enableLabel`): `"出力をターゲット言語に翻訳する"`

(Use translation reasoning consistent with the existing locale's tone — check 1-2 adjacent settings keys in each file for voice and verb conjugation conventions.)

**Step 4: Run and confirm PASS** (10 tests).

**Step 5: Commit**

```bash
git add tests/translation-i18n-keys.test.mjs src/locales/*/translation.json
git commit -m "$(cat <<'EOF'
新增 AI 翻译设置的 10 语言 i18n 文案 / Add i18n strings for AI translation settings across 10 locales

中文
  概述：为 SettingsPage 即将新增的 AI 翻译输出区块补齐 10 个语言文案。
  变更：
    1. en/es/fr/de/pt/it/ru/ja/zh-CN/zh-TW 的 translation.json 各加 8 个 keys。
    2. 测试守护 10 个 locale × 8 个 key 均非空字符串。
  验证：
    1. node --test tests/translation-i18n-keys.test.mjs:10 pass。
    2. npm run i18n:check 通过(若该脚本检查 key 一致性)。
English
  Summary: Add 8 settings strings for the upcoming AI Translation Output panel
  in each of 10 locales.
  Changes:
    1. translation.json updated for en/es/fr/de/pt/it/ru/ja/zh-CN/zh-TW.
    2. Test guards 10 locales × 8 keys, all non-empty strings.
  Verification:
    1. node --test tests/translation-i18n-keys.test.mjs: 10 pass.
    2. npm run i18n:check passes (if that script validates key parity).
EOF
)"
```

---

### Task 2.3: Render the "AI Translation Output" settings panel

**Files:**
- Modify: `src/components/SettingsPage.tsx` — extend `AiModelsSection` to read translation settings and append a new sub-panel; the panel renders below the cleanup section in `case "aiModels"` and `case "intelligence"`.
- Reuse: `LanguageSelector` (already imported indirectly via the transcription section pattern at line 801)

**Step 1: Write the failing test**

Create `tests/settings-page-translation-panel.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/SettingsPage.tsx"),
  "utf8"
);

test("SettingsPage AiModelsSection renders the translation panel", () => {
  assert.match(source, /settingsPage\.aiTranslation\.title/);
  assert.match(source, /settingsPage\.aiTranslation\.enableLabel/);
  assert.match(source, /settingsPage\.aiTranslation\.targetLangLabel/);
});

test("SettingsPage threads translation settings through props", () => {
  assert.match(source, /translationEnabled:\s*boolean/);
  assert.match(source, /translationTargetLang:\s*string/);
  assert.match(source, /setTranslationEnabled:\s*\(value:\s*boolean\)\s*=>\s*void/);
  assert.match(source, /setTranslationTargetLang:\s*\(value:\s*string\)\s*=>\s*void/);
});

test("Toggling translation on with empty target language is blocked at UI", () => {
  assert.match(source, /settingsPage\.aiTranslation\.requireTargetLang/);
});
```

**Step 2: Run, confirm FAIL.**

**Step 3: Implement.**

In `src/components/SettingsPage.tsx`:

1. Pull `translationEnabled, translationTargetLang, setTranslationEnabled, setTranslationTargetLang` from `useSettings()` at the top of `SettingsPage` (search for the existing `useSettings()` call ~line 280–400 and add to destructure).
2. Extend `AiModelsSectionProps` interface to include these 4 fields.
3. In `AiModelsSection`, after the existing cleanup section JSX (just before the closing component tag) add a new `<SettingsPanel>` block:

```tsx
<div>
  <SectionHeader
    title={t("settingsPage.aiTranslation.title")}
    description={t("settingsPage.aiTranslation.description")}
  />
  <SettingsPanel>
    <SettingsPanelRow>
      <SettingsRow
        label={t("settingsPage.aiTranslation.enableLabel")}
        description={t("settingsPage.aiTranslation.enableDescription")}
      >
        <Toggle
          checked={translationEnabled}
          onCheckedChange={(value) => {
            if (value && !translationTargetLang) {
              showAlertDialog({
                title: t("settingsPage.aiTranslation.title"),
                description: t("settingsPage.aiTranslation.requireTargetLang"),
              });
              return;
            }
            setTranslationEnabled(value);
          }}
        />
      </SettingsRow>
    </SettingsPanelRow>
    <SettingsPanelRow>
      <SettingsRow
        label={t("settingsPage.aiTranslation.targetLangLabel")}
        description={t("settingsPage.aiTranslation.targetLangDescription")}
      >
        <LanguageSelector
          value={translationTargetLang}
          onChange={(value) => setTranslationTargetLang(value)}
        />
      </SettingsRow>
    </SettingsPanelRow>
    <SettingsPanelRow>
      <p className="text-xs text-muted-foreground px-1">
        {t("settingsPage.aiTranslation.providerNote")}
      </p>
    </SettingsPanelRow>
  </SettingsPanel>
</div>
```

4. Update both `case "aiModels"` (~line 947) AND `case "intelligence"` (~line 994) `AiModelsSection` invocations to pass the 4 new props.

5. `LanguageSelector` accepts an optional `options` prop (default: full `REGISTRY_OPTIONS`). For translation target, **exclude `auto`** — pass:
   ```tsx
   options={REGISTRY_OPTIONS.filter((opt) => opt.value !== "auto")}
   ```
   Import `REGISTRY_OPTIONS` or build it inline via `registry.languages` (see `src/components/ui/LanguageSelector.tsx:13-17`). Cleaner: export `REGISTRY_OPTIONS` from `LanguageSelector.tsx` so callers can filter.

**Step 4: Run tests, type-check, confirm PASS.**

```bash
node --test tests/settings-page-translation-panel.test.mjs    # expect 3 pass
npm run typecheck                                              # expect 0 errors
```

**Step 5: Update CHANGELOG.md** under `[Unreleased]` → `Added`:

```
- AI Translation Output: a Settings toggle that unifies multilingual dictation into a single target language. Translation and cleanup share the same provider/model in a single LLM call.
```

**Step 6: Commit**

```bash
git add tests/settings-page-translation-panel.test.mjs src/components/SettingsPage.tsx src/components/ui/LanguageSelector.tsx CHANGELOG.md
git commit -m "$(cat <<'EOF'
SettingsPage 加 AI 翻译输出面板 / Add AI Translation Output panel to SettingsPage

中文
  概述：在 AI 模型区块下方新增"AI 翻译输出"面板,提供开关、目标语言选择与
  Provider 共用说明;开关在目标语言未选时弹提示阻止启用。
  变更：
    1. AiModelsSection 增加 4 个 props 与 SettingsPanel 子块。
    2. case "aiModels" 与 case "intelligence" 同步传入新 props。
    3. LanguageSelector 导出 REGISTRY_OPTIONS 供调用方过滤 auto。
    4. CHANGELOG [Unreleased] Added 一条用户可见说明。
  验证：
    1. node --test tests/settings-page-translation-panel.test.mjs:3 pass。
    2. npm run typecheck 通过。
English
  Summary: Add an AI Translation Output panel below the AI Models cleanup
  section: enable toggle, target-language picker, and provider-sharing note.
  Toggle blocks enabling translation while target language is unset.
  Changes:
    1. AiModelsSection accepts 4 new props and renders the SettingsPanel.
    2. Both case "aiModels" and case "intelligence" thread the new props.
    3. LanguageSelector exports REGISTRY_OPTIONS so callers can drop "auto".
    4. CHANGELOG [Unreleased] gains a user-visible Added entry.
  Verification:
    1. node --test tests/settings-page-translation-panel.test.mjs: 3 pass.
    2. npm run typecheck: clean.
EOF
)"
```

---

## Phase 3 — Prompt Injection Engine

### Task 3.1: Add placeholder helpers in `src/config/prompts.ts`

> ⚠ **User-provided prompt text:** The actual prompt block strings (English + Chinese variants) are supplied by the user. This task scaffolds the structure with `TODO_PROMPT_TEXT` placeholders. Before completing the task, **ask the user to paste the final prompt strings** and replace the placeholders.

**Files:**
- Modify: `src/config/prompts.ts`

**Step 1: Write the failing test**

Create `tests/prompt-translation-injection.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";

const promptsPath = new URL("../src/config/prompts.ts", import.meta.url);
const source = await import("node:fs").then((fs) =>
  fs.promises.readFile(promptsPath, "utf8")
);

test("prompts.ts exports renderTargetLangBlock and renderDictTranslationRuleBlock", () => {
  assert.match(source, /export\s+function\s+renderTargetLangBlock\s*\(targetLang:\s*string,\s*uiLanguage\?:\s*string\)/);
  assert.match(
    source,
    /export\s+function\s+renderDictTranslationRuleBlock\s*\(targetLang:\s*string,\s*uiLanguage\?:\s*string\)/
  );
});

test("getSystemPrompt signature accepts translation context", () => {
  assert.match(
    source,
    /export\s+function\s+getSystemPrompt\([\s\S]*?translationContext\?:\s*\{[\s\S]*?enabled:\s*boolean[\s\S]*?targetLang:\s*string/
  );
});

test("getSystemPrompt injects via placeholder when present", () => {
  assert.match(source, /\{\{TARGET_LANG_INSTRUCTION\}\}/);
  assert.match(source, /\{\{DICTIONARY_TRANSLATION_RULE\}\}/);
  assert.match(source, /replaceAll\("\{\{TARGET_LANG_INSTRUCTION\}\}",/);
});

test("getSystemPrompt strips empty placeholders when translation is off", () => {
  // when block is empty string, placeholder replacement removes it entirely
  assert.match(source, /replaceAll\("\{\{TARGET_LANG_INSTRUCTION\}\}",\s*targetLangBlock\)/);
});
```

**Step 2: Confirm FAIL.**

**Step 3: Implement scaffolding.**

In `src/config/prompts.ts`:

```typescript
// Phase 3 — translation prompt blocks. Text supplied by user; do not invent.
export function renderTargetLangBlock(targetLang: string, uiLanguage?: string): string {
  if (!targetLang) return "";
  const isZh = (uiLanguage || "zh-CN").startsWith("zh");
  if (isZh) {
    return `TODO_PROMPT_TEXT_TARGET_LANG_ZH (target: ${targetLang})`;
  }
  return `TODO_PROMPT_TEXT_TARGET_LANG_EN (target: ${targetLang})`;
}

export function renderDictTranslationRuleBlock(
  targetLang: string,
  uiLanguage?: string
): string {
  if (!targetLang) return "";
  const isZh = (uiLanguage || "zh-CN").startsWith("zh");
  if (isZh) {
    return `TODO_PROMPT_TEXT_DICT_RULE_ZH (target: ${targetLang})`;
  }
  return `TODO_PROMPT_TEXT_DICT_RULE_EN (target: ${targetLang})`;
}

function injectOrAppend(prompt: string, placeholder: string, block: string): string {
  if (prompt.includes(placeholder)) {
    return prompt.replaceAll(placeholder, block);
  }
  if (!block) return prompt;
  return `${prompt}\n\n${block}`;
}
```

Extend `getSystemPrompt`:

```typescript
export function getSystemPrompt(
  customDictionary?: string[],
  uiLanguage?: string,
  terminologyProfile?: Partial<TerminologyProfile> | null,
  translationContext?: { enabled: boolean; targetLang: string }
): string {
  const prompts = getPromptBundle(uiLanguage);

  let prompt = prompts.cleanupPrompt;
  if (typeof window !== "undefined" && window.localStorage) {
    prompt = readCustomCleanupPrompt(window.localStorage) || prompt;
  }

  // dictionary list injection (unchanged)
  if (customDictionary && customDictionary.length > 0) {
    const normalizedDictionary = Array.from(
      new Set(customDictionary.map((word) => word.trim()).filter(Boolean))
    );
    if (normalizedDictionary.length > 0) {
      prompt += `${prompts.dictionarySuffix}${normalizedDictionary.join(", ")}`;
      prompt += `\n\n${getDictionaryEnforcementInstruction(uiLanguage)}`;
    }
  }

  // terminology profile (unchanged)
  const terminologyInstruction = getTerminologyInstruction(terminologyProfile);
  if (terminologyInstruction) {
    prompt += `\n\n${terminologyInstruction}`;
  }

  // translation blocks
  const translationEnabled = !!translationContext?.enabled && !!translationContext?.targetLang;
  const dictNonEmpty = !!customDictionary && customDictionary.length > 0;

  const targetLangBlock = translationEnabled
    ? renderTargetLangBlock(translationContext!.targetLang, uiLanguage)
    : "";
  const dictRuleBlock =
    translationEnabled && dictNonEmpty
      ? renderDictTranslationRuleBlock(translationContext!.targetLang, uiLanguage)
      : "";

  prompt = injectOrAppend(prompt, "{{TARGET_LANG_INSTRUCTION}}", targetLangBlock);
  prompt = injectOrAppend(prompt, "{{DICTIONARY_TRANSLATION_RULE}}", dictRuleBlock);

  return prompt;
}
```

**Step 4: Confirm PASS** (4 tests).

**Step 5: Commit** (uses placeholder prompt text — user fills in Task 3.2)

```bash
git add tests/prompt-translation-injection.test.mjs src/config/prompts.ts
git commit -m "$(cat <<'EOF'
Prompt 注入引擎支持翻译占位符 / Add placeholder-based translation prompt injection

中文
  概述：getSystemPrompt 扩展接收 translationContext,通过 {{TARGET_LANG_INSTRUCTION}}
  与 {{DICTIONARY_TRANSLATION_RULE}} 占位符注入翻译规则;占位符存在则替换,不存在则
  末尾追加。renderTargetLangBlock / renderDictTranslationRuleBlock 暂用占位文案,
  待下个 commit 由用户填入最终 prompt 模板。
  变更：
    1. 新增 renderTargetLangBlock / renderDictTranslationRuleBlock(占位文案)。
    2. getSystemPrompt 签名加 translationContext 可选参数。
    3. 占位符替换 + 末尾 fallback 注入策略。
  验证：
    1. node --test tests/prompt-translation-injection.test.mjs:4 pass。
English
  Summary: getSystemPrompt accepts an optional translationContext. The translation
  rules are injected via the {{TARGET_LANG_INSTRUCTION}} and
  {{DICTIONARY_TRANSLATION_RULE}} placeholders if present, otherwise appended at
  the prompt's tail. renderTargetLangBlock / renderDictTranslationRuleBlock use
  placeholder text for now; the next commit will replace it with the user's
  finalized prompt templates.
  Changes:
    1. New renderTargetLangBlock / renderDictTranslationRuleBlock (placeholder text).
    2. getSystemPrompt gains an optional translationContext parameter.
    3. Placeholder substitution + tail-append fallback strategy.
  Verification:
    1. node --test tests/prompt-translation-injection.test.mjs: 4 pass.
EOF
)"
```

---

### Task 3.2: ⚠ USER-SUPPLIED — Fill in actual translation prompt text

**Files:**
- Modify: `src/config/prompts.ts:renderTargetLangBlock` and `renderDictTranslationRuleBlock`

**Steps:**

1. Pause and ask the user: "Please paste the final prompt block text for `renderTargetLangBlock` (en + zh variants) and `renderDictTranslationRuleBlock` (en + zh variants). They should embed `${targetLang}` where appropriate."
2. Replace the 4 `TODO_PROMPT_TEXT_...` strings with the user's text.
3. Update / add tests in `tests/prompt-translation-injection.test.mjs` to assert the user-provided phrases are present (one canonical phrase per block).
4. Re-run `node --test tests/prompt-translation-injection.test.mjs` — all green.
5. Commit:

```bash
git commit -am "$(cat <<'EOF'
填入翻译 prompt 正式模板 / Plug in finalized translation prompt templates

中文
  概述：把 Task 3.1 的占位文案替换为用户提供的正式翻译规则模板(en + zh 各一份)。
  验证：
    1. node --test tests/prompt-translation-injection.test.mjs 全部 pass。
English
  Summary: Replace the placeholder text from Task 3.1 with the user-supplied
  finalized translation rule templates (en + zh variants each).
  Verification:
    1. node --test tests/prompt-translation-injection.test.mjs: all pass.
EOF
)"
```

---

### Task 3.3: Wire translation context into `BaseReasoningService`

**Files:**
- Modify: `src/services/BaseReasoningService.ts:28-34` (`getSystemPrompt` method body)

**Step 1: Write the failing test**

Create `tests/base-reasoning-service-translation.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/services/BaseReasoningService.ts"),
  "utf8"
);

test("BaseReasoningService.getSystemPrompt forwards translation context", () => {
  assert.match(
    source,
    /getSystemPrompt\(\)\s*:\s*string\s*\{[\s\S]*?translationEnabled[\s\S]*?translationTargetLang/
  );
  assert.match(
    source,
    /getSystemPrompt\(\s*[\s\S]*?\{\s*enabled:\s*[\s\S]*?translationEnabled[\s\S]*?targetLang:\s*[\s\S]*?translationTargetLang[\s\S]*?\}\s*\)/
  );
});
```

**Step 2: Confirm FAIL.**

**Step 3: Implement.** In `BaseReasoningService.ts`:

```typescript
protected getSystemPrompt(): string {
  const settings = getSettings();
  return getSystemPrompt(
    this.getCustomDictionary(),
    this.getUiLanguage(),
    this.getTerminologyProfile(),
    {
      enabled: !!settings.translationEnabled,
      targetLang: settings.translationTargetLang || "",
    }
  );
}
```

**Step 4: Confirm PASS** + full baseline.

```bash
node --test tests/base-reasoning-service-translation.test.mjs
node --test tests/*.test.mjs tests/*.test.cjs 2>&1 | grep -E "^ℹ"
```

**Step 5: Commit**

```bash
git add tests/base-reasoning-service-translation.test.mjs src/services/BaseReasoningService.ts
git commit -m "$(cat <<'EOF'
BaseReasoningService 透传翻译上下文 / Forward translation context from BaseReasoningService

中文
  概述：BaseReasoningService.getSystemPrompt 把当前 settings 的 translationEnabled
  与 translationTargetLang 透传给 getSystemPrompt,使 4 个 reasoning provider
  统一看到注入了翻译规则的 system prompt。
  变更：
    1. getSystemPrompt 调用增 translationContext 参数。
  验证：
    1. node --test tests/base-reasoning-service-translation.test.mjs:1 pass。
    2. 完整 baseline 无新增失败。
English
  Summary: BaseReasoningService.getSystemPrompt now forwards the current
  settings' translationEnabled and translationTargetLang to getSystemPrompt,
  so all 4 reasoning providers see the same translation-aware system prompt.
  Changes:
    1. getSystemPrompt invocation gains a translationContext argument.
  Verification:
    1. node --test tests/base-reasoning-service-translation.test.mjs: 1 pass.
    2. Full baseline: no new failures.
EOF
)"
```

---

## Phase 4 — PromptStudio Banner

### Task 4.1: Show translation banner + insert-placeholder button in PromptStudio Edit tab

**Files:**
- Modify: `src/components/ui/PromptStudio.tsx`
- Modify: `src/locales/{all 10}/translation.json` — add banner i18n keys

**Step 1: Add i18n keys.** In each of the 10 locale files add under `promptStudio`:

```json
"translationBanner": {
  "title": "Translation enabled → target: {{lang}}",
  "explainer": "Translation rules are inserted at this placeholder location in your prompt: {{placeholder}}. When the placeholder is missing, the rules are appended to the end of the prompt.",
  "example": "Example:",
  "insertButton": "Insert placeholder at cursor"
}
```

**Step 2: Write the failing test**

Create `tests/prompt-studio-translation-banner.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/ui/PromptStudio.tsx"),
  "utf8"
);

test("PromptStudio reads translation settings and renders banner when enabled", () => {
  assert.match(source, /translationEnabled\b/);
  assert.match(source, /translationTargetLang\b/);
  assert.match(source, /promptStudio\.translationBanner\.title/);
  assert.match(source, /promptStudio\.translationBanner\.insertButton/);
  assert.match(source, /\{\{TARGET_LANG_INSTRUCTION\}\}/);
});
```

**Step 3: Confirm FAIL.**

**Step 4: Implement.** In `PromptStudio.tsx`:

1. Add to the selectors near line 70-73:

```tsx
const translationEnabled = useSettingsStore((s) => s.translationEnabled);
const translationTargetLang = useSettingsStore((s) => s.translationTargetLang);
```

2. Create a `<textarea>` ref to enable cursor insertion:

```tsx
const editorRef = useRef<HTMLTextAreaElement>(null);
```

3. Inside `activeTab === "edit"` block (around line 269), **before** the `<Textarea>`, add the conditional banner:

```tsx
{translationEnabled && translationTargetLang && (
  <div className="px-5 py-4 border-b border-border/40 dark:border-border-subtle">
    <div className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 px-4 py-3 space-y-2">
      <p className="text-xs font-medium text-foreground">
        {t("promptStudio.translationBanner.title", { lang: translationTargetLang })}
      </p>
      <p className="text-xs text-muted-foreground leading-relaxed">
        {t("promptStudio.translationBanner.explainer", {
          placeholder: "{{TARGET_LANG_INSTRUCTION}}",
        })}
      </p>
      <div className="text-xs text-muted-foreground">
        <p className="mb-1">{t("promptStudio.translationBanner.example")}</p>
        <pre className="text-xs font-mono bg-muted/30 dark:bg-surface-raised/30 border border-border/30 rounded p-2 leading-relaxed">
{`Please clean up the spoken transcript into formal writing.
{{TARGET_LANG_INSTRUCTION}}
Do not change meaning. Preserve proper nouns.`}
        </pre>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-7 text-xs"
        onClick={() => {
          const el = editorRef.current;
          if (!el) return;
          const start = el.selectionStart ?? editedPrompt.length;
          const end = el.selectionEnd ?? editedPrompt.length;
          const next =
            editedPrompt.slice(0, start) +
            "{{TARGET_LANG_INSTRUCTION}}" +
            editedPrompt.slice(end);
          setEditedPrompt(next);
          requestAnimationFrame(() => {
            el.focus();
            const cursor = start + "{{TARGET_LANG_INSTRUCTION}}".length;
            el.setSelectionRange(cursor, cursor);
          });
        }}
      >
        {t("promptStudio.translationBanner.insertButton")}
      </Button>
    </div>
  </div>
)}
```

4. Add `ref={editorRef}` to the existing `<Textarea>` (around line 282-288).

**Step 5: Confirm PASS + typecheck**

```bash
node --test tests/prompt-studio-translation-banner.test.mjs
npm run typecheck
```

**Step 6: Update CHANGELOG.md** under `[Unreleased]` → `Added`:

```
- PromptStudio shows an inline banner when translation is enabled, explaining the {{TARGET_LANG_INSTRUCTION}} placeholder and offering a one-click insert button at the cursor.
```

**Step 7: Commit**

```bash
git add tests/prompt-studio-translation-banner.test.mjs src/components/ui/PromptStudio.tsx src/locales/*/translation.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
PromptStudio 显示翻译开启提示与占位符插入按钮 / Add translation banner with insert-placeholder action

中文
  概述：翻译启用且目标语言已选时,PromptStudio 编辑页显示提示横幅与占位符示例,
  并提供"插入占位符到光标"快捷按钮。
  变更：
    1. PromptStudio 读取 translationEnabled / translationTargetLang。
    2. 编辑 Tab 内条件渲染翻译横幅 + 示例 + 插入按钮。
    3. 10 个 locale 加 promptStudio.translationBanner.* 文案。
    4. CHANGELOG 加用户可见说明。
  验证：
    1. node --test tests/prompt-studio-translation-banner.test.mjs:1 pass。
    2. npm run typecheck 通过。
English
  Summary: When translation is enabled with a target language picked, the
  PromptStudio Edit tab renders an inline banner explaining the placeholder
  syntax with a one-click insert action.
  Changes:
    1. PromptStudio subscribes to translationEnabled / translationTargetLang.
    2. Edit tab conditionally renders the banner, example, and button.
    3. promptStudio.translationBanner.* added to all 10 locales.
    4. CHANGELOG gains a user-visible Added entry.
  Verification:
    1. node --test tests/prompt-studio-translation-banner.test.mjs: 1 pass.
    2. npm run typecheck: clean.
EOF
)"
```

---

## Phase 5 — HistoryView Raw-Text Disclosure

### Task 5.1: Fold raw transcript inside TranscriptionItem when present

**Files:**
- Modify: `src/components/ui/TranscriptionItem.tsx`
- Modify: `src/locales/{all 10}/translation.json` — add disclosure i18n keys

**Step 1: Add i18n keys.** Under `controlPanel.history`:

```json
"viewRawTranscript": "View raw transcript",
"rawTranscriptLabel": "Raw transcript"
```

**Step 2: Write the failing test**

Create `tests/transcription-item-raw-disclosure.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/components/ui/TranscriptionItem.tsx"),
  "utf8"
);

test("TranscriptionItem renders a <details> disclosure for raw_text when present", () => {
  assert.match(source, /item\.raw_text/);
  assert.match(source, /<details/);
  assert.match(source, /controlPanel\.history\.viewRawTranscript/);
});

test("TranscriptionItem hides the disclosure when raw_text is missing or equal to text", () => {
  // The component should guard rendering with a condition like
  // item.raw_text && item.raw_text.trim() !== item.text.trim()
  assert.match(
    source,
    /item\.raw_text[\s\S]*?\.trim\(\)\s*!==\s*item\.text\.trim\(\)/
  );
});
```

**Step 3: Confirm FAIL.**

**Step 4: Implement.** In `TranscriptionItem.tsx`, after the existing `<p className="flex-1 min-w-0...">{item.text}</p>` (line 90-92), add:

```tsx
{item.raw_text && item.raw_text.trim() !== item.text.trim() && (
  <details
    className="mt-2 ml-0"
    onClick={(e) => e.stopPropagation()}
  >
    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground select-none list-none">
      ▸ {t("controlPanel.history.viewRawTranscript")}
    </summary>
    <div className="mt-1 ml-3 pl-2 border-l border-border/40 text-[11px] text-muted-foreground/80 whitespace-pre-wrap break-words leading-[1.5]">
      <span className="block text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">
        {t("controlPanel.history.rawTranscriptLabel")}
      </span>
      {item.raw_text}
    </div>
  </details>
)}
```

Note the `onClick={(e) => e.stopPropagation()}` is required — the parent `<div role="button">` (line 73-82) wires a click handler that copies; we must not trigger it when expanding the details.

**Step 5: Confirm PASS + typecheck**

```bash
node --test tests/transcription-item-raw-disclosure.test.mjs
npm run typecheck
```

**Step 6: Update CHANGELOG.md** under `[Unreleased]` → `Added`:

```
- History items now disclose the raw transcript (pre-cleanup / pre-translation) on demand via an expandable "View raw transcript" toggle. Legacy items without a recorded raw transcript continue to show only the final text.
```

**Step 7: Commit**

```bash
git add tests/transcription-item-raw-disclosure.test.mjs src/components/ui/TranscriptionItem.tsx src/locales/*/translation.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
HistoryView 折叠展示原始转录 / Disclose raw transcript inside history items

中文
  概述：TranscriptionItem 在 raw_text 存在且与最终文本不同时,渲染 <details>
  折叠展示原稿;老数据(raw_text 为 NULL)不显示折叠器,体验不变。
  变更：
    1. TranscriptionItem 加 <details> 块 + stopPropagation 防触发复制。
    2. 10 个 locale 加 viewRawTranscript / rawTranscriptLabel 文案。
    3. CHANGELOG 加用户可见说明。
  验证：
    1. node --test tests/transcription-item-raw-disclosure.test.mjs:2 pass。
    2. npm run typecheck 通过。
English
  Summary: When raw_text exists and differs from the final text,
  TranscriptionItem renders a <details> disclosure to show the original
  transcript. Legacy items (raw_text NULL) do not get the disclosure — UI
  unchanged.
  Changes:
    1. TranscriptionItem renders a <details> block with stopPropagation.
    2. 10 locales gain viewRawTranscript / rawTranscriptLabel strings.
    3. CHANGELOG gains a user-visible Added entry.
  Verification:
    1. node --test tests/transcription-item-raw-disclosure.test.mjs: 2 pass.
    2. npm run typecheck: clean.
EOF
)"
```

---

## Phase 6 — Failure Fallback + Toast

### Task 6.1: Surface fallback reason to the toast layer

**Files:**
- Modify: `src/helpers/audioManager.js:2190-2274` (`processTranscription` already returns `fallbackReason` from Task 1.3 — confirm and expand)
- Modify: `src/hooks/useAudioRecording.js` (around line 603) — detect fallback flag, show toast
- Modify: `src/locales/{all 10}/translation.json` — add toast i18n keys

**Step 1: Add i18n keys.** Under `hooks.audioRecording`:

```json
"translationFallback": {
  "title": "Translation unavailable",
  "description": "We pasted the original transcript instead. Check your reasoning provider and try again."
}
```

**Step 2: Write the failing test**

Create `tests/translation-fallback-toast.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

test("audioManager sets _lastFallbackReason when reasoning fails", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src/helpers/audioManager.js"), "utf8");
  assert.match(
    source,
    /this\._lastFallbackReason\s*=\s*"reasoning_failed"/
  );
});

test("useAudioRecording shows the translation-fallback toast when reason is set", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src/hooks/useAudioRecording.js"), "utf8");
  assert.match(source, /_lastFallbackReason/);
  assert.match(source, /hooks\.audioRecording\.translationFallback\.title/);
});
```

**Step 3: Confirm FAIL.**

**Step 4: Implement.**

In `src/helpers/audioManager.js` `processTranscription` catch branch (around line 2259-2266), set the fallback reason on the instance before returning normalized text:

```javascript
} catch (error) {
  this._lastFallbackReason = "reasoning_failed";
  logger.logReasoning("REASONING_FAILED", {
    error: error.message,
    stack: error.stack,
    fallbackToCleanup: true,
  });
  logger.warn("Reasoning failed", { source, error: error.message }, "reasoning");
}
```

On successful paths in the same function, set `this._lastFallbackReason = null` before returning, so the flag is per-utterance.

In `src/hooks/useAudioRecording.js` after the existing `audioManagerRef.current.saveTranscription(...)` (~line 603), only show the toast **when translation is enabled** (a generic cleanup failure shouldn't trigger translation-specific copy):

```javascript
const fallbackReason = audioManagerRef.current._lastFallbackReason;
const settingsForToast = getSettings();
if (fallbackReason === "reasoning_failed" && settingsForToast.translationEnabled) {
  toast({
    title: t("hooks.audioRecording.translationFallback.title"),
    description: t("hooks.audioRecording.translationFallback.description"),
    variant: "destructive",
  });
}
```

(Import `getSettings` if not already in scope — check existing imports in `useAudioRecording.js`.)

**Step 5: Confirm PASS + baseline**

```bash
node --test tests/translation-fallback-toast.test.mjs
node --test tests/*.test.mjs tests/*.test.cjs 2>&1 | grep -E "^ℹ"
```

**Step 6: Update CHANGELOG.md** under `[Unreleased]` → `Added`:

```
- Translation failure fallback: when the combined cleanup+translate LLM call fails (network, quota, etc.) the original transcript is pasted and an inline toast notifies the user. Only fires when translation is enabled.
```

**Step 7: Commit**

```bash
git add tests/translation-fallback-toast.test.mjs src/helpers/audioManager.js src/hooks/useAudioRecording.js src/locales/*/translation.json CHANGELOG.md
git commit -m "$(cat <<'EOF'
翻译失败回退原文并弹 toast / Fall back to raw transcript and toast on translation failure

中文
  概述：合并的 cleanup+translate LLM 调用失败时,粘贴原始转录文本,并在翻译
  开启状态下弹出 destructive toast 告知用户。
  变更：
    1. audioManager.processTranscription catch 分支记录 _lastFallbackReason。
    2. useAudioRecording 在 saveTranscription 后检查标志并弹 toast。
    3. 10 个 locale 加 translationFallback.title / description。
    4. CHANGELOG 加用户可见说明。
  验证：
    1. node --test tests/translation-fallback-toast.test.mjs:2 pass。
    2. 完整 baseline 无新增失败。
English
  Summary: When the merged cleanup+translate LLM call fails, the raw transcript
  is pasted instead and a destructive toast notifies the user — but only when
  translation is enabled.
  Changes:
    1. audioManager.processTranscription catch branch records
       _lastFallbackReason.
    2. useAudioRecording checks the flag after saveTranscription and shows
       the toast.
    3. translationFallback.title / description added to all 10 locales.
    4. CHANGELOG gains a user-visible Added entry.
  Verification:
    1. node --test tests/translation-fallback-toast.test.mjs: 2 pass.
    2. Full baseline: no new failures.
EOF
)"
```

---

## Phase 7 — Final Hardening

### Task 7.1: Full baseline + typecheck

**Steps:**

1. Run the full test suite, type check, and i18n check:

```bash
node --test tests/*.test.mjs tests/*.test.cjs 2>&1 | grep -E "^ℹ"
npm run typecheck
npm run i18n:check
```

Expected: all green, **0 failures**, tests count ≈ 400 + 14 new = 414.

2. If any failure surfaces, debug **without modifying baseline tests**. New tests we added should pass; existing tests should still be green.

### Task 7.2: Manual smoke tests

**Run the app:**

```bash
npm run dev
```

**Smoke test matrix (4 scenarios):**

| # | Setup | Input | Expected |
|---|---|---|---|
| 1 | translation=on, target=en, provider=OpenAI/GPT-5-mini | 中文一句话 | 粘贴英文译文；history 折叠原文可展开看中文 |
| 2 | same | English sentence | 粘贴 cleanup 后英文（不重写）；history 不显示折叠（raw == final） |
| 3 | same | 中英混合句 | 粘贴统一英文；history 折叠原文可展开看混合 |
| 4 | same, **then disconnect network** | any sentence | 粘贴原文 + 红色 toast "Translation unavailable"；history 中 raw == final（都是原文） |

If any scenario fails, file a follow-up commit before claiming Phase 7 done. Record results in a comment on the PR.

### Task 7.3: Final commit + PR preparation

Verify CHANGELOG `[Unreleased]` contains 4 user-visible Added entries (P2.3, P4, P5, P6) and no stale lines.

```bash
git log --oneline main..HEAD                 # confirm commit history is clean
git diff main..HEAD --stat                   # confirm scope is reasonable
```

Prepare a PR title: `feat: AI translation output unifies multilingual dictation`.

PR body (suggested):

```markdown
## Summary
- Add an "AI Translation Output" panel: a toggle + target language picker.
- When enabled, cleanup + translation are merged into a single LLM call; failures fall back to the raw transcript with a destructive toast.
- HistoryView discloses the raw transcript via a `<details>` toggle.
- PromptStudio shows a translation-aware banner with a `{{TARGET_LANG_INSTRUCTION}}` insert button.

## Test plan
- [x] `node --test tests/*.test.mjs tests/*.test.cjs` — 0 failures
- [x] `npm run typecheck` — 0 errors
- [x] `npm run i18n:check` — passes
- [x] Manual smoke (4 scenarios above) — all pass
```

---

## Appendix — File-Change Cheat Sheet

| Layer | File | Change |
|---|---|---|
| DB | `src/helpers/database.js` | + `raw_text` column + migration + `saveTranscription(text, rawText)` |
| IPC | `src/helpers/ipcHandlers.js` | `db-save-transcription` extra param |
| IPC | `preload.js` | `saveTranscription(text, rawText)` bridge |
| Types | `src/types/electron.ts` | `TranscriptionItem.raw_text?: string \| null`, IPC signature |
| Renderer flow | `src/helpers/audioManager.js` | `processTranscription` returns `{ finalText, rawText, fallbackReason }`; `saveTranscription(text, rawText)`; sets `_lastRawText` / `_lastFallbackReason` |
| Renderer flow | `src/hooks/useAudioRecording.js` | calls `saveTranscription(text, rawText)`; toasts on fallback |
| Settings | `src/hooks/useSettings.ts` | adds `translationEnabled`, `translationTargetLang` |
| Settings | `src/stores/settingsStore.ts` | initial values, setters, BOOLEAN_SETTINGS membership |
| Settings UI | `src/components/SettingsPage.tsx` | new sub-panel in `AiModelsSection` (both `case "aiModels"` and `case "intelligence"`) |
| Lang select | `src/components/ui/LanguageSelector.tsx` | export `REGISTRY_OPTIONS` |
| Prompts | `src/config/prompts.ts` | `renderTargetLangBlock`, `renderDictTranslationRuleBlock`, placeholder injection, `getSystemPrompt` signature |
| Reasoning | `src/services/BaseReasoningService.ts` | forward `translationContext` |
| Prompt UI | `src/components/ui/PromptStudio.tsx` | translation banner + insert-placeholder button |
| History UI | `src/components/ui/TranscriptionItem.tsx` | `<details>` disclosure for raw_text |
| i18n | `src/locales/{10 locales}/translation.json` | new keys in 4 namespaces (`settingsPage.aiTranslation`, `promptStudio.translationBanner`, `controlPanel.history.viewRawTranscript`/`rawTranscriptLabel`, `hooks.audioRecording.translationFallback`) |
| Docs | `CHANGELOG.md` | 4 `[Unreleased]` → `Added` entries (P2.3, P4, P5, P6) |
