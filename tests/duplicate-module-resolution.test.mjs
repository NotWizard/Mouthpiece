import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("renderer-sensitive app policy imports use explicit extensions when JS and TS siblings coexist", async () => {
  const [audioManagerSource, contextClassifierSource] = await Promise.all([
    readRepoFile("src/helpers/audioManager.js"),
    readRepoFile("src/utils/contextClassifier.ts"),
  ]);

  assert.doesNotMatch(audioManagerSource, /from\s+["']\.\.\/config\/sensitiveAppPolicy["']/);
  assert.doesNotMatch(contextClassifierSource, /from\s+["']\.\.\/config\/sensitiveAppPolicy["']/);
});
