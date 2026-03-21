import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(repoRoot, relativePath), "utf8");
}

async function loadPromptsModule() {
  const tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "mouthpiece-prompts-test-"));
  const outfile = path.join(tempDir, "prompts.bundle.mjs");

  await esbuild.build({
    entryPoints: [path.resolve(repoRoot, "src/config/prompts.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile,
    logLevel: "silent",
  });

  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const localStorage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
    clear() {},
  };

  globalThis.window = {
    localStorage,
    addEventListener() {},
    dispatchEvent() {},
  };
  globalThis.localStorage = localStorage;

  const moduleUrl = `${pathToFileURL(outfile).href}?ts=${Date.now()}`;
  const imported = await import(moduleUrl);

  return {
    module: imported,
    cleanup() {
      if (previousWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previousWindow;
      }
      if (previousLocalStorage === undefined) {
        delete globalThis.localStorage;
      } else {
        globalThis.localStorage = previousLocalStorage;
      }
      fsSync.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("audio manager reasoning config includes a resolved post-processing policy", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /resolvePostProcessingPolicy/);
  assert.match(source, /postProcessingPolicy:\s*resolvePostProcessingPolicy\(/);
  assert.match(source, /contextClassification/);
  assert.doesNotMatch(source, /preferredOutputStrategy:\s*getSettings\(\)\.defaultOutputStrategy/);
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

test("prompt generation applies explicit policy instructions without requiring context classification", async () => {
  const { module, cleanup } = await loadPromptsModule();

  try {
    const prompt = module.getSystemPrompt(
      "AI",
      [],
      "en",
      "keep userIdValue exactly",
      "en",
      undefined,
      {
        surfaceMode: "ide",
        outputStrategy: "raw_first",
        allowStructuredRewrite: false,
        preserveIdentifiers: true,
        preserveFormatting: true,
      }
    );

    assert.match(prompt, /Surface mode: ide\./);
    assert.match(prompt, /Output strategy: raw_first\./);
    assert.match(
      prompt,
      /Preserve identifiers, symbols, casing, filenames, and code-like tokens exactly\./
    );
    assert.match(
      prompt,
      /Preserve visible formatting, list markers, Markdown structure, and intentional line breaks\./
    );
    assert.doesNotMatch(prompt, /Context hint:/);
  } finally {
    cleanup();
  }
});
