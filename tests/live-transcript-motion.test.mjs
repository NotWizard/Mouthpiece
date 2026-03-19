import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadMotionModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/liveTranscriptMotion.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("live transcript motion leaves fitting text anchored without offset", async () => {
  const mod = await loadMotionModule();

  assert.equal(typeof mod.getLiveTranscriptOffsetPx, "function");
  assert.equal(mod.getLiveTranscriptOffsetPx({ contentWidthPx: 180, viewportWidthPx: 220 }), 0);
});

test("live transcript motion scrolls overflowing text left while preserving a small trailing reveal", async () => {
  const mod = await loadMotionModule();

  assert.equal(typeof mod.getLiveTranscriptOffsetPx, "function");
  assert.equal(
    mod.getLiveTranscriptOffsetPx({
      contentWidthPx: 340,
      viewportWidthPx: 220,
      trailingRevealPx: 12,
    }),
    -132
  );
});

test("live transcript motion trims only far-off history instead of replacing the visible line with an ellipsis tail", async () => {
  const mod = await loadMotionModule();

  assert.equal(typeof mod.normalizeLiveTranscriptText, "function");

  const text = mod.normalizeLiveTranscriptText(
    "我现在来测试一下这个实时转录胶囊随着语音持续输入时的滚动显示效果，而且前面的词应该平滑地退出视野",
    { maxChars: 24 }
  );

  assert.equal(text.startsWith("…"), false);
  assert.equal(Array.from(text).length <= 24, true);
  assert.equal(text.endsWith("而且前面的词应该平滑地退出视野"), true);
});
