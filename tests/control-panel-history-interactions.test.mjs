import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("sidebar keeps the default home view id but labels it as history in every locale", async () => {
  const sidebarSource = await readRepoFile("src/components/ControlPanelSidebar.tsx");
  assert.match(sidebarSource, /\{ id: "home", label: t\("sidebar\.home"\), icon: Home \}/);

  const expectedHomeLabels = {
    de: "Verlauf",
    en: "History",
    es: "Historial",
    fr: "Historique",
    it: "Cronologia",
    ja: "履歴",
    pt: "Histórico",
    ru: "История",
    "zh-CN": "历史记录",
    "zh-TW": "歷史記錄",
  };

  for (const [locale, label] of Object.entries(expectedHomeLabels)) {
    const source = await readRepoFile(`src/locales/${locale}/translation.json`);
    const translations = JSON.parse(source);
    assert.equal(translations.sidebar.home, label, `${locale} sidebar.home`);
  }
});

test("history rows copy from the whole row and show an inline copied state", async () => {
  const [itemSource, controlPanelSource, historySource, zhSource] = await Promise.all([
    readRepoFile("src/components/ui/TranscriptionItem.tsx"),
    readRepoFile("src/components/ControlPanel.tsx"),
    readRepoFile("src/components/HistoryView.tsx"),
    readRepoFile("src/locales/zh-CN/translation.json"),
  ]);

  assert.match(itemSource, /onCopy: \(text: string\) => Promise<boolean>/);
  assert.match(itemSource, /role="button"/);
  assert.match(itemSource, /tabIndex=\{0\}/);
  assert.match(itemSource, /onClick=\{handleCopy\}/);
  assert.match(itemSource, /onKeyDown=\{handleKeyDown\}/);
  assert.match(itemSource, /event\.stopPropagation\(\)/);
  assert.match(itemSource, /controlPanel\.history\.copiedInline/);
  assert.match(itemSource, /text-emerald-/);
  assert.match(controlPanelSource, /window\.electronAPI\?\.writeClipboard/);
  assert.match(controlPanelSource, /return true;/);
  assert.match(controlPanelSource, /return false;/);
  assert.match(historySource, /copyToClipboard: \(text: string\) => Promise<boolean>/);

  const translations = JSON.parse(zhSource);
  assert.equal(translations.controlPanel.history.copiedInline, "已复制");
});

test("microphone input test cards use a compact non-even layout", async () => {
  const source = await readRepoFile("src/components/ui/MicrophoneSettings.tsx");

  assert.match(source, /MIC_TEST_STATUS_CARD_CLASS =\s*"min-h-\[56px\]/);
  assert.match(source, /MIC_TEST_DYNAMIC_TEXT_CLASS =\s*"mt-0\.5 min-h-\[1\.125rem\]/);
  assert.match(source, /md:grid-cols-\[minmax\(118px,0\.7fr\)_minmax\(150px,0\.95fr\)_minmax\(220px,1\.45fr\)\]/);
  assert.doesNotMatch(source, /sm:grid-cols-3/);
});
