import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(repoRoot, relativePath), "utf8");
}

test("audio manager reasoning config includes a resolved post-processing policy", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /resolvePostProcessingPolicy/);
  assert.match(source, /postProcessingPolicy:\s*resolvePostProcessingPolicy\(/);
});

test("reasoning services propagate post-processing policy through prompt generation", async () => {
  const [baseSource, serviceSource] = await Promise.all([
    readRepoFile("src/services/BaseReasoningService.ts"),
    readRepoFile("src/services/ReasoningService.ts"),
  ]);

  assert.match(baseSource, /postProcessingPolicy\?:/);
  assert.match(baseSource, /postProcessingPolicy\?:\s*PostProcessingPolicy/);
  assert.match(serviceSource, /config\.postProcessingPolicy/);
});
