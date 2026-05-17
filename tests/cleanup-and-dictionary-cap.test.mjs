import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

async function loadDictionaryHelper() {
  // The helper is an ES module (.mjs) so Vite/Rollup can statically analyze
  // its named exports for renderer bundling — load it via dynamic import.
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/helpers/customDictionaryPrompt.mjs")
  ).href;
  return import(modulePath);
}

test("will-quit awaits server / streaming shutdown via Promise.allSettled (no fire-and-forget)", async () => {
  const source = await readRepoFile("main.js");
  // Pull the will-quit handler body and confirm it (a) awaits a Promise.all*
  // collection, (b) preventDefault()'s the quit so we can wait, (c) ultimately
  // calls app.exit(0).
  const willQuitIdx = source.indexOf('app.on("will-quit"');
  assert.ok(willQuitIdx !== -1, "will-quit handler must exist");
  const willQuitBlock = source.slice(willQuitIdx, willQuitIdx + 4000);
  assert.match(
    willQuitBlock,
    /event\.preventDefault\(\)/,
    "will-quit must call event.preventDefault() so it can await async shutdown"
  );
  assert.match(
    willQuitBlock,
    /Promise\.allSettled/,
    "will-quit must await Promise.allSettled over the shutdown promises"
  );
  assert.match(
    willQuitBlock,
    /app\.exit\(0\)/,
    "will-quit must explicitly app.exit(0) once shutdown finishes"
  );
});

test("will-quit collects every streaming helper's dispose call (assemblyAi / deepgram / soniox / qwen-realtime)", async () => {
  const source = await readRepoFile("main.js");
  const willQuitIdx = source.indexOf('app.on("will-quit"');
  const willQuitBlock = source.slice(willQuitIdx, willQuitIdx + 4000);
  assert.match(
    willQuitBlock,
    /assemblyAiStreaming/,
    "will-quit must dispose / cleanup the AssemblyAI streaming helper"
  );
  assert.match(
    willQuitBlock,
    /deepgramStreaming/,
    "will-quit must dispose / cleanup the Deepgram streaming helper"
  );
  assert.match(
    willQuitBlock,
    /sonioxStreaming/,
    "will-quit must dispose / cleanup the Soniox streaming helper"
  );
  assert.match(
    willQuitBlock,
    /qwenRealtime|bailianRealtimeStreaming|qwenStreaming|qwen.*Streaming/i,
    "will-quit must dispose / cleanup the Qwen / Bailian realtime streaming helper"
  );
});

test("authBridgeServer shutdown destroys active sockets so quit doesn't hang on in-flight OAuth calls", async () => {
  const source = await readRepoFile("main.js");
  // Either we use closeAllConnections() OR maintain a socket Set + destroy.
  assert.match(
    source,
    /(closeAllConnections|authBridgeSockets)/,
    "main.js must drop active connections on authBridgeServer shutdown to prevent will-quit hangs"
  );
});

test("customDictionary helper exists and is bounded by character count, keeping the most recently added words", async () => {
  const mod = await loadDictionaryHelper();
  assert.equal(typeof mod.buildCustomDictionaryPrompt, "function");

  // Long array of words; helper must keep the most recent ones until the
  // character budget is exhausted.
  const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
  const prompt = mod.buildCustomDictionaryPrompt(words, { maxChars: 200 });
  assert.ok(prompt.length <= 200, `prompt length ${prompt.length} must not exceed maxChars 200`);
  assert.ok(
    prompt.includes("word499"),
    "the most recently added word must survive the truncation"
  );
});

test("customDictionary helper returns empty / null for empty input", async () => {
  const mod = await loadDictionaryHelper();
  assert.equal(mod.buildCustomDictionaryPrompt([]), null);
  assert.equal(mod.buildCustomDictionaryPrompt(null), null);
  assert.equal(mod.buildCustomDictionaryPrompt(undefined), null);
});

test("audioManager.js delegates customDictionary prompt assembly to the bounded helper", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");
  // The original implementation joined the entire array. The fix should pull in
  // the helper so the >224-token Whisper truncation bug is mitigated.
  assert.match(
    source,
    /buildCustomDictionaryPrompt/,
    "audioManager.js must use buildCustomDictionaryPrompt instead of words.join(', ') so the prompt is capped"
  );
});
