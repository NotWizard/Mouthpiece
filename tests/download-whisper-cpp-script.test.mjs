import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("download-whisper-cpp skips release fetching when current-platform binary already exists", async () => {
  const source = await readRepoFile("scripts/download-whisper-cpp.js");

  assert.match(source, /if \(args\.isCurrent\)/);
  assert.match(source, /fs\.existsSync\(outputPath\) && !args\.isForce/);

  const skipCheckIndex = source.indexOf('if (fs.existsSync(outputPath) && !args.isForce)');
  const fetchIndex = source.indexOf("const release = await getRelease();");

  assert.notEqual(skipCheckIndex, -1);
  assert.notEqual(fetchIndex, -1);
  assert.ok(skipCheckIndex < fetchIndex, "skip check should happen before fetching the release");
});
