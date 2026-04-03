import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("main loading surfaces reuse the shared current logo asset instead of the legacy inline svg", async () => {
  const source = await readRepoFile("src/main.jsx");

  assert.match(source, /import logoIcon from "\.\/assets\/icon\.png";/);
  assert.match(source, /<img class="logo" src="\$\{logoIcon\}" alt="Mouthpiece" \/>/);
  assert.match(
    source,
    /<img\s+src=\{logoIcon\}\s+alt="Mouthpiece"\s+className="w-12 h-12 object-contain/
  );
  assert.doesNotMatch(source, /<svg class="logo" viewBox="0 0 1024 1024" width="64" height="64"/);
  assert.doesNotMatch(source, /<svg[\s\S]*drop-shadow-\[0_2px_8px_rgba\(37,99,235,0\.18\)\][\s\S]*<\/svg>/);
});
