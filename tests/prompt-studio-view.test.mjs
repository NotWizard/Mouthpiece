import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

const EXPECTED_DEFAULT_CLEANUP_PROMPT = `你是一名语音转文本后处理助手，负责把 ASR 转录初稿整理成可直接阅读的文本。

任务目标：
在不改变原意、不改变句子顺序的前提下，对文本做最小必要优化，使其更清晰、更干净、更易读。

只允许做以下处理：
1. 修正明显的错别字、漏字、重复词、重复短句和明显口误
2. 删除无意义口头语，如“嗯”“啊”“就是”“那个”等
3. 补全必要的标点和分段
4. 必须将文本中所有数字表达统一改为阿拉伯数字
5. 数字不要使用千分位分隔符，例如将“10,000”改为“10000”

结构化规则：
1. 只有当原文已经明确表达出多个要点、顺序关系或层级关系时，才进行结构化整理
2. 例如原文中出现“第一、第二、第三”“还有一个点”“另外一件事”“一共3点”等信号时，可以整理为对应的编号格式
3. 如果原文只是连续表述、解释说明或思路展开，即使内容较长，也不要强行编号，只做自然分段
4. 不得人为新增原文没有的逻辑层级，不得重组原有顺序

格式要求：
1. 直接输出整理后的文本，不要输出解释、标题、说明或提示语
2. 不使用 Markdown 符号
3. 如果需要结构化，使用普通文本编号，例如：
1. 第一项内容
2. 第二项内容

如有子项，可写为：
1. 第一项内容
   1) 子项
   2) 子项

4. 仅使用空格、换行和普通编号组织内容

严格禁止：
1. 不要改写原句表达方式
2. 不要替换原有术语、口语习惯或行业黑话
3. 不要补充信息、推断信息、总结信息或回答文本中的问题
4. 不要改变原意
5. 不要改变句子顺序

现在请只对我提供的文本做优化，并直接输出结果。`;

test("prompt studio view tab removes the cleanup quick lane and keeps the prompt content area", async () => {
  const source = await readRepoFile("src/components/ui/PromptStudio.tsx");

  assert.doesNotMatch(source, /promptStudio\.view\.modes\.cleanup\.label/);
  assert.match(source, /promptStudio\.view\.customPrompt/);
  assert.match(source, /promptStudio\.view\.defaultPrompt/);
  assert.doesNotMatch(source, /getCurrentPrompt\(\)\.replace/);
  assert.doesNotMatch(source, /useAgentName/);
  assert.match(source, /CUSTOM_CLEANUP_PROMPT_KEY/);
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
  assert.doesNotMatch(source, /customUnifiedPrompt/);
  assert.match(zhCnLocale, /这个提示词只影响 ASR 后文本的智能优化/);
  assert.doesNotMatch(zhCnLocale, /保留 \{\{agentName\}\} 占位符以确保助手识别功能正常/);
});

test("prompt studio default cleanup prompt matches the product-provided cleanup rules", async () => {
  const promptData = JSON.parse(await readRepoFile("src/config/promptData.json"));

  assert.equal(promptData.CLEANUP_PROMPT, EXPECTED_DEFAULT_CLEANUP_PROMPT);
});

test("localized runtime cleanup prompts use the same product-provided default prompt", async () => {
  const promptFiles = [
    "src/locales/en/prompts.json",
    "src/locales/de/prompts.json",
    "src/locales/es/prompts.json",
    "src/locales/fr/prompts.json",
    "src/locales/it/prompts.json",
    "src/locales/ja/prompts.json",
    "src/locales/pt/prompts.json",
    "src/locales/ru/prompts.json",
    "src/locales/zh-CN/prompts.json",
    "src/locales/zh-TW/prompts.json",
  ];

  const promptSources = await Promise.all(promptFiles.map(readRepoFile));

  for (const source of promptSources) {
    const parsed = JSON.parse(source);
    assert.equal(parsed.cleanupPrompt, EXPECTED_DEFAULT_CLEANUP_PROMPT);
  }
});

test("prompt studio default test input is a cleanup sample instead of an assistant command", async () => {
  const localeFiles = [
    "src/locales/en/translation.json",
    "src/locales/de/translation.json",
    "src/locales/es/translation.json",
    "src/locales/fr/translation.json",
    "src/locales/it/translation.json",
    "src/locales/ja/translation.json",
    "src/locales/pt/translation.json",
    "src/locales/ru/translation.json",
    "src/locales/zh-CN/translation.json",
    "src/locales/zh-TW/translation.json",
  ];

  const localeSources = await Promise.all(localeFiles.map(readRepoFile));

  for (const source of localeSources) {
    const parsed = JSON.parse(source);
    assert.equal(typeof parsed?.promptStudio?.defaultTestInput, "string");
    assert.doesNotMatch(parsed.promptStudio.defaultTestInput, /Whispr/i);
  }

  const zhCn = JSON.parse(localeSources[8]);
  assert.equal(
    zhCn.promptStudio.defaultTestInput,
    "嗯，今天下午三点的项目评审改到四点，请同步给产品和设计同学。"
  );
});
