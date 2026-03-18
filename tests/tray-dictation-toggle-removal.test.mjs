import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("tray menu no longer exposes manual dictation panel visibility toggles", async () => {
  const [traySource, zhCnTranslations] = await Promise.all([
    readRepoFile("src/helpers/tray.js"),
    readRepoFile("src/locales/zh-CN/translation.json"),
  ]);

  assert.match(traySource, /buildContextMenuTemplate\(\)\s*\{/);
  assert.match(traySource, /label: i18nMain\.t\("tray\.openControlPanel"\)/);
  assert.match(traySource, /label: i18nMain\.t\("tray\.quit"\)/);

  assert.doesNotMatch(traySource, /tray\.toggleDictation/);
  assert.doesNotMatch(traySource, /isDictationPanelVisible\(\)/);
  assert.doesNotMatch(traySource, /hideDictationPanel\(\)/);
  assert.doesNotMatch(traySource, /showDictationPanel\(\{ focus: true \}\)/);

  assert.doesNotMatch(zhCnTranslations, /"toggleDictation"/);
});
