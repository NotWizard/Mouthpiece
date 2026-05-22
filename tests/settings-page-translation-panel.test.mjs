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

test("Toggling translation on with empty target language auto-defaults to en", () => {
  assert.match(
    source,
    /if \(value && !translationTargetLang\) \{\s*setTranslationTargetLang\("en"\);/
  );
});
