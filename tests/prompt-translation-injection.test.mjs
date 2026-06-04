import test from "node:test";
import assert from "node:assert/strict";

const promptsPath = new URL("../src/config/prompts.ts", import.meta.url);
const source = await import("node:fs").then((fs) =>
  fs.promises.readFile(promptsPath, "utf8")
);

test("prompts.ts no longer exports the legacy translation placeholder", () => {
  assert.doesNotMatch(source, /TRANSLATION_PLACEHOLDER/);
  assert.doesNotMatch(source, /\{\{TARGET_LANGUAGE\}\}/);
});

test("prompts.ts no longer ships the deprecated translation block helpers", () => {
  assert.doesNotMatch(source, /export function renderTargetLangBlock/);
  assert.doesNotMatch(source, /export function renderDictTranslationRuleBlock/);
  assert.doesNotMatch(source, /\{\{DICTIONARY_TRANSLATION_RULE\}\}/);
});

test("getSystemPrompt signature accepts translation context with triggeredByHotkey", () => {
  assert.match(
    source,
    /export\s+function\s+getSystemPrompt\([\s\S]*?translationContext\?:\s*\{[\s\S]*?enabled:\s*boolean[\s\S]*?targetLang:\s*string[\s\S]*?triggeredByHotkey\?:\s*boolean/
  );
});

test("getSystemPrompt resolves language display name from the registry", () => {
  assert.match(source, /import \{ getLanguageLabel \} from "\.\.\/utils\/languageRegistry"/);
  assert.match(
    source,
    /const langDisplayName = getLanguageLabel\(translationContext\.targetLang\)/
  );
});

test("getSystemPrompt auto-appends the language sentence only on translation-hotkey dictations", () => {
  assert.match(
    source,
    /translationContext\?\.enabled[\s\S]*?translationContext\.targetLang[\s\S]*?translationContext\.triggeredByHotkey/
  );
  assert.match(source, /输出结果的语言必须是：\$\{langDisplayName\}/);
  assert.match(source, /The output language must be: \$\{langDisplayName\}/);
  assert.match(source, /prompt = `\$\{prompt\}\\n\\n\$\{fallbackSentence\}`/);
});

test("getSystemPrompt does not perform any string-level placeholder replace", () => {
  assert.doesNotMatch(source, /prompt\.replaceAll\(/);
});

test("prompts.ts exports both Chinese and English versions of the safety guardrail", () => {
  assert.match(source, /export const SAFETY_GUARDRAIL_SUFFIX_ZH\s*=/);
  assert.match(source, /export const SAFETY_GUARDRAIL_SUFFIX_EN\s*=/);
  assert.match(source, /SAFETY_GUARDRAIL_SUFFIX_ZH[\s\S]*?安全护栏/);
  assert.match(source, /SAFETY_GUARDRAIL_SUFFIX_ZH[\s\S]*?<transcript>/);
  assert.match(source, /SAFETY_GUARDRAIL_SUFFIX_EN[\s\S]*?SAFETY GUARDRAIL/);
  assert.match(source, /SAFETY_GUARDRAIL_SUFFIX_EN[\s\S]*?<transcript>/);
});

test("prompts.ts exports getSafetyGuardrailSuffix routing by uiLanguage", () => {
  assert.match(source, /export function getSafetyGuardrailSuffix\(uiLanguage\?:\s*string\)/);
  // The helper must return ZH for zh-* locales and EN otherwise.
  assert.match(
    source,
    /locale\.startsWith\("zh"\)\s*\?\s*SAFETY_GUARDRAIL_SUFFIX_ZH\s*:\s*SAFETY_GUARDRAIL_SUFFIX_EN/
  );
});

test("getSystemPrompt unconditionally appends the routed guardrail (top-level, not gated)", () => {
  // The append statement must appear at top level of getSystemPrompt — NOT
  // inside an `if` — so the guardrail is injected for every caller regardless
  // of custom-prompt / dictionary / terminology / translation state. This is
  // the load-bearing line for the upgrade scenario: existing users whose
  // saved customCleanupPrompt predates the guardrail still get protected.
  assert.match(source, /\n {2}prompt \+= getSafetyGuardrailSuffix\(uiLanguage\);/);
});

test("guardrail injection happens before the translation directive (translation directive must stay last)", () => {
  const guardrailIndex = source.indexOf("prompt += getSafetyGuardrailSuffix");
  const translationBlockIndex = source.indexOf("translationContext?.enabled");
  assert.ok(guardrailIndex > 0, "guardrail injection statement missing");
  assert.ok(translationBlockIndex > 0, "translation block missing");
  assert.ok(
    guardrailIndex < translationBlockIndex,
    "guardrail must be appended BEFORE the translation directive so the language directive stays last"
  );
});

test("default cleanup prompt body no longer ships the safety guardrail (runtime-injected instead)", async () => {
  const fs = await import("node:fs/promises");
  const promptDataJson = JSON.parse(
    await fs.readFile(new URL("../src/config/promptData.json", import.meta.url), "utf8")
  );
  assert.doesNotMatch(promptDataJson.CLEANUP_PROMPT, /安全护栏/);
  assert.doesNotMatch(promptDataJson.CLEANUP_PROMPT, /<transcript>/);
});

test("every locale cleanupPrompt body is free of the safety guardrail (runtime-injected instead)", async () => {
  const fs = await import("node:fs/promises");
  const locales = ["en", "de", "es", "fr", "it", "ja", "pt", "ru", "zh-CN", "zh-TW"];
  for (const loc of locales) {
    const data = JSON.parse(
      await fs.readFile(
        new URL(`../src/locales/${loc}/prompts.json`, import.meta.url),
        "utf8"
      )
    );
    assert.doesNotMatch(data.cleanupPrompt, /安全护栏/, `${loc} cleanupPrompt still contains 安全护栏`);
    assert.doesNotMatch(data.cleanupPrompt, /<transcript>/, `${loc} cleanupPrompt still contains <transcript> tag`);
  }
});
