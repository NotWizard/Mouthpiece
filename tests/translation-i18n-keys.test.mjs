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
