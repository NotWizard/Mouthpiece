import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("renderer i18n treats non-English locale bundles as partially bundled so zh-CN can load", async () => {
  const source = await readRepoFile("src/i18n.ts");

  assert.match(
    source,
    /partialBundledLanguages:\s*true/,
    "i18next must lazy-load zh-CN instead of treating the English-only resource map as complete"
  );
});

test("UI language selector renders flag emoji with an explicit emoji font fallback", async () => {
  const [selectorSource, cssSource] = await Promise.all([
    readRepoFile("src/components/ui/LanguageSelector.tsx"),
    readRepoFile("src/index.css"),
  ]);

  assert.match(selectorSource, /className="[^"]*language-flag[^"]*"/);
  assert.match(cssSource, /\.language-flag\s*\{/);
  assert.match(cssSource, /Apple Color Emoji/);
  assert.match(cssSource, /Segoe UI Emoji/);
  assert.match(cssSource, /Noto Color Emoji/);
});
