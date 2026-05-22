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
  assert.match(source, /replaceAll\("\{\{TARGET_LANG_INSTRUCTION\}\}",\s*targetLangBlock\)/);
});
