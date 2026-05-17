import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("processWithOpenAI does not silently return the raw transcript on an empty response", async () => {
  const source = await readRepoFile("src/services/ReasoningService.ts");
  // The bug: when responseText was empty, the function logged a fallback event and
  // returned `text` (the raw input) — making the caller believe cleanup ran.
  // The fix should throw or otherwise surface failure so the caller's fallback
  // path runs (and logs / toast / metrics fire).
  assert.doesNotMatch(
    source,
    /OPENAI_EMPTY_RESPONSE_FALLBACK[\s\S]{0,400}return\s+text\s*;/,
    "OpenAI empty-response branch must not silently return the raw input — it must throw so the caller can decide how to fall back"
  );
});

test("processWithOpenAI throws an explicit error when the API returns no usable text", async () => {
  const source = await readRepoFile("src/services/ReasoningService.ts");
  assert.match(
    source,
    /(OPENAI_EMPTY_RESPONSE_FALLBACK|empty)[\s\S]{0,400}throw\s+new\s+Error/,
    "OpenAI empty-response branch must throw a descriptive error"
  );
});

test("Anthropic IPC handler defends against an empty content array before reading content[0].text", async () => {
  const source = await readRepoFile("src/helpers/ipcHandlers.js");
  // The bug: data.content[0].text.trim() throws TypeError when content === [].
  // The fix should detect missing content and return a structured failure with
  // a friendly message — not let a stray TypeError bubble up through the IPC.
  assert.doesNotMatch(
    source,
    /text:\s*data\.content\[0\]\.text\.trim\(\)/,
    "Anthropic IPC must not assume data.content[0] exists; refusal / truncation responses can have an empty content array"
  );
  assert.match(
    source,
    /data\?\.content|Array\.isArray\(data\?\.content\)|content[\s\S]{0,80}find/,
    "Anthropic IPC must defensively inspect data.content before reading text"
  );
});

test("Anthropic IPC handler uses canonical lowercase x-api-key header", async () => {
  const source = await readRepoFile("src/helpers/ipcHandlers.js");
  // X-API-Key works because HTTP headers are case-insensitive but signals copy-paste
  // imprecision; the Anthropic SDK and docs use lowercase.
  assert.doesNotMatch(
    source,
    /"X-API-Key"/,
    "Anthropic IPC should use the canonical lowercase x-api-key header"
  );
  assert.match(
    source,
    /["']x-api-key["']\s*:\s*apiKey/,
    "Anthropic IPC must send the lowercase x-api-key header"
  );
});

test("llama-server inference attempts a lazy restart instead of throwing 'not running' immediately", async () => {
  const source = await readRepoFile("src/helpers/llamaServer.js");
  // Whisper / qwen lazy-restart in their transcribe path; llama-server should
  // mirror that so a single OOM / sleep does not require manual model toggle.
  assert.doesNotMatch(
    source,
    /async\s+inference\s*\([^)]*\)\s*\{\s*if\s*\(\s*!this\.ready\s*\|\|\s*!this\.process\s*\)\s*\{\s*throw\s+new\s+Error\(\s*["']llama-server is not running["']/,
    "inference() should not throw 'not running' as the very first guard — it should attempt a lazy restart first"
  );
  assert.match(
    source,
    /async\s+inference\s*\([\s\S]{0,400}(await\s+this\.start|this\.start\()/,
    "inference() must call this.start(...) to lazy-restart when the server is not ready"
  );
});

test("llama-server caches enough to support lazy restart after death", async () => {
  const source = await readRepoFile("src/helpers/llamaServer.js");
  // To restart we need either modelPath / lastOptions cached, or some other
  // way to remember the last working configuration.
  assert.match(
    source,
    /this\.(modelPath|lastOptions|lastModelPath)/,
    "llama-server must remember the last model / options so inference() can lazy-restart after a crash"
  );
});
