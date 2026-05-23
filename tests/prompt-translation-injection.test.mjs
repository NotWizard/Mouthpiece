import test from "node:test";
import assert from "node:assert/strict";

const promptsPath = new URL("../src/config/prompts.ts", import.meta.url);
const source = await import("node:fs").then((fs) =>
  fs.promises.readFile(promptsPath, "utf8")
);

test("prompts.ts exports the translation placeholder constant", () => {
  assert.match(
    source,
    /export const TRANSLATION_PLACEHOLDER = "\{\{TARGET_LANG_INSTRUCTION\}\}";/
  );
});

test("prompts.ts no longer ships the deprecated translation block helpers", () => {
  assert.doesNotMatch(source, /export function renderTargetLangBlock/);
  assert.doesNotMatch(source, /export function renderDictTranslationRuleBlock/);
  assert.doesNotMatch(source, /\{\{DICTIONARY_TRANSLATION_RULE\}\}/);
});

test("getSystemPrompt signature accepts translation context", () => {
  assert.match(
    source,
    /export\s+function\s+getSystemPrompt\([\s\S]*?translationContext\?:\s*\{[\s\S]*?enabled:\s*boolean[\s\S]*?targetLang:\s*string/
  );
});

test("getSystemPrompt resolves placeholder to language display name when translation is enabled", () => {
  assert.match(source, /import \{ getLanguageLabel \} from "\.\.\/utils\/languageRegistry"/);
  assert.match(
    source,
    /const langDisplayName = getLanguageLabel\(translationContext!\.targetLang\)/
  );
  assert.match(source, /prompt\.replaceAll\(TRANSLATION_PLACEHOLDER, langDisplayName\)/);
});

test("getSystemPrompt appends a default sentence when prompt has no placeholder", () => {
  assert.match(source, /输出结果的语言必须是：\$\{TRANSLATION_PLACEHOLDER\}/);
  assert.match(source, /The output language must be: \$\{TRANSLATION_PLACEHOLDER\}/);
  assert.match(source, /if \(!prompt\.includes\(TRANSLATION_PLACEHOLDER\)\)/);
});

test("getSystemPrompt strips the placeholder when translation is off", () => {
  assert.match(
    source,
    /\/\/ Translation off:[\s\S]*?prompt = prompt\.replaceAll\(TRANSLATION_PLACEHOLDER, ""\);/
  );
});
