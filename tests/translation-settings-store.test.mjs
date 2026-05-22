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
