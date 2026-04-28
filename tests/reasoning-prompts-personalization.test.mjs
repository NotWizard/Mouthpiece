import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

async function loadPromptsModule() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mouthpiece-prompts-personalization-"));
  const outfile = path.join(tempDir, "prompts.bundle.mjs");

  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), "src/config/prompts.ts")],
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

  const imported = await import(`${pathToFileURL(outfile).href}?ts=${Date.now()}`);

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
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("system prompt includes terminology personalization guidance for preferred and avoided terms", async () => {
  const { module, cleanup } = await loadPromptsModule();

  try {
    const prompt = module.getSystemPrompt(
      "Mouthpiece",
      ["Raycast"],
      "en",
      "open race cast",
      "en",
      undefined,
      undefined,
      {
        hotwords: ["Raycast"],
        blacklistedTerms: ["umm"],
        homophoneMappings: [{ source: "race cast", target: "Raycast" }],
        glossaryTerms: ["Project Atlas"],
        pendingSuggestions: [{ term: "WeRSS", sourceTerm: "V R S S", source: "auto_learn_edit" }],
      }
    );

    assert.match(prompt, /Preferred terminology:/);
    assert.match(prompt, /Raycast/);
    assert.match(prompt, /Project Atlas/);
    assert.match(prompt, /Avoid these terms when a better correction is available:/);
    assert.match(prompt, /umm/);
    assert.match(prompt, /Homophone normalization candidates:/);
    assert.match(prompt, /race cast → Raycast/);
    assert.doesNotMatch(prompt, /Pending terminology suggestions for review:/);
    assert.doesNotMatch(prompt, /V R S S → WeRSS/);
    assert.doesNotMatch(prompt, /WeRSS/);
  } finally {
    cleanup();
  }
});
