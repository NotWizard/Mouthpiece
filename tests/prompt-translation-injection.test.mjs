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
