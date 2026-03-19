import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("download-whisper-cpp skips source build work when current-platform binary already exists", async () => {
  const source = await readRepoFile("scripts/download-whisper-cpp.js");

  assert.match(source, /if \(args\.isCurrent\)/);
  assert.match(source, /fs\.existsSync\(outputPath\) && !args\.isForce/);
  assert.match(source, /buildWhisperServerFromSource/);

  const skipCheckIndex = source.indexOf("if (fs.existsSync(outputPath) && !args.isForce)");
  const buildBannerIndex = source.indexOf("[whisper-server] Building upstream source");
  const buildCallIndex = source.indexOf("const ok = await buildWhisperServerFromSource(");

  assert.notEqual(skipCheckIndex, -1);
  assert.notEqual(buildBannerIndex, -1);
  assert.notEqual(buildCallIndex, -1);
  assert.ok(
    skipCheckIndex < buildBannerIndex,
    "skip check should happen before logging the source-build path"
  );
  assert.ok(
    skipCheckIndex < buildCallIndex,
    "skip check should happen before invoking the source-build helper"
  );
});
