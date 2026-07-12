import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("intelligence settings no longer render a redundant custom setup mode card", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.doesNotMatch(source, /settingsPage\.aiModels\.customSetup/);
  assert.doesNotMatch(source, /settingsPage\.aiModels\.customSetupDescription/);
  assert.doesNotMatch(source, /Mode selector - NOTE: Mouthpiece Cloud option hidden/);
  assert.match(source, /useReasoningModel && cloudReasoningMode !== "byok"/);
  assert.match(source, /useReasoningModel && \(/);
  assert.doesNotMatch(source, /\(isCustomMode \|\| !isSignedIn\) && \(/);
});

test("privacy data sidebar item is labeled as permissions and data in every locale", async () => {
  const expectedPrivacyDataLabels = {
    de: {
      label: "Berechtigungen & Daten",
      description: "Berechtigungen, Datenschutz und lokale Daten",
    },
    en: {
      label: "Permissions & Data",
      description: "Permissions, privacy, and local data",
    },
    es: {
      label: "Permisos y datos",
      description: "Permisos, privacidad y datos locales",
    },
    fr: {
      label: "Autorisations et données",
      description: "Autorisations, confidentialité et données locales",
    },
    it: {
      label: "Permessi e dati",
      description: "Permessi, privacy e dati locali",
    },
    ja: {
      label: "権限とデータ",
      description: "権限、プライバシー、ローカルデータ",
    },
    pt: {
      label: "Permissões e dados",
      description: "Permissões, privacidade e dados locais",
    },
    ru: {
      label: "Разрешения и данные",
      description: "Разрешения, конфиденциальность и локальные данные",
    },
    "zh-CN": {
      label: "权限与数据",
      description: "权限、隐私与本地数据",
    },
    "zh-TW": {
      label: "權限與資料",
      description: "權限、隱私與本機資料",
    },
  };

  for (const [locale, expected] of Object.entries(expectedPrivacyDataLabels)) {
    const source = await readRepoFile(`src/locales/${locale}/translation.json`);
    const translations = JSON.parse(source);
    assert.deepEqual(translations.settingsModal.sections.privacyData, expected, locale);
  }
});
