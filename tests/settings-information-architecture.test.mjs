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

test("privacy data sidebar item is labeled as permissions in every locale", async () => {
  const expectedPrivacyDataLabels = {
    de: {
      label: "Berechtigungen",
      description: "Mikrofon- und Bedienungshilfen-Berechtigungen",
    },
    en: {
      label: "Permissions",
      description: "Microphone and accessibility permissions",
    },
    es: {
      label: "Permisos",
      description: "Permisos de micrófono y accesibilidad",
    },
    fr: {
      label: "Autorisations",
      description: "Autorisations du microphone et d'accessibilité",
    },
    it: {
      label: "Permessi",
      description: "Permessi per microfono e accessibilità",
    },
    ja: {
      label: "権限",
      description: "マイクとアクセシビリティの権限",
    },
    pt: {
      label: "Permissões",
      description: "Permissões de microfone e acessibilidade",
    },
    ru: {
      label: "Разрешения",
      description: "Разрешения для микрофона и универсального доступа",
    },
    "zh-CN": {
      label: "权限",
      description: "麦克风与辅助功能权限",
    },
    "zh-TW": {
      label: "權限",
      description: "麥克風與輔助使用權限",
    },
  };

  for (const [locale, expected] of Object.entries(expectedPrivacyDataLabels)) {
    const source = await readRepoFile(`src/locales/${locale}/translation.json`);
    const translations = JSON.parse(source);
    assert.deepEqual(translations.settingsModal.sections.privacyData, expected, locale);
  }
});
