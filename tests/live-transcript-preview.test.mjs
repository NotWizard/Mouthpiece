import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadPreviewModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/liveTranscriptPreview.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("live transcript preview keeps short text unchanged", async () => {
  const mod = await loadPreviewModule();

  assert.equal(typeof mod.buildLiveTranscriptPreview, "function");
  assert.equal(mod.buildLiveTranscriptPreview("你好，世界", { maxChars: 12 }), "你好，世界");
});

test("live transcript preview trims older content from the front and keeps the latest speech visible", async () => {
  const mod = await loadPreviewModule();

  assert.equal(typeof mod.buildLiveTranscriptPreview, "function");

  const preview = mod.buildLiveTranscriptPreview(
    "我现在来测试一下这个实时转录胶囊随着语音持续输入时的滚动显示效果",
    { maxChars: 14 }
  );

  assert.equal(preview.startsWith("…"), true);
  assert.equal(preview.length <= 15, true);
  assert.equal(preview.endsWith("持续输入时的滚动显示效果"), true);
});
