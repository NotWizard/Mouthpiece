import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("prompt studio view tab removes the cleanup quick lane and keeps the prompt content area", async () => {
  const source = await readRepoFile("src/components/ui/PromptStudio.tsx");

  assert.doesNotMatch(source, /promptStudio\.view\.modes\.cleanup\.label/);
  assert.match(source, /promptStudio\.view\.customPrompt/);
  assert.match(source, /promptStudio\.view\.defaultPrompt/);
  assert.match(source, /getCurrentPrompt\(\)\.replace/);
});

test("prompt studio custom warning describes AI cleanup instead of agent detection", async () => {
  const [source, zhCnLocale] = await Promise.all([
    readRepoFile("src/components/ui/PromptStudio.tsx"),
    readRepoFile("src/locales/zh-CN/translation.json"),
  ]);

  assert.match(source, /promptStudio\.edit\.cautionText/);
  assert.doesNotMatch(source, /promptStudio\.edit\.cautionTextPrefix/);
  assert.doesNotMatch(source, /promptStudio\.edit\.cautionTextSuffix/);
  assert.doesNotMatch(source, /\{"\{\{agentName\}\}"\}/);
  assert.match(zhCnLocale, /这个提示词只影响 ASR 后文本的智能优化/);
  assert.doesNotMatch(zhCnLocale, /保留 \{\{agentName\}\} 占位符以确保助手识别功能正常/);
});
