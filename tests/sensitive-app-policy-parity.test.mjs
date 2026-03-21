import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const require = createRequire(import.meta.url);

function loadJsModule(relativePath) {
  return require(path.resolve(process.cwd(), relativePath));
}

async function loadTsModule(relativePath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mouthpiece-sensitive-policy-"));
  const outfile = path.join(tempDir, "policy.bundle.mjs");

  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), relativePath)],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile,
    logLevel: "silent",
  });

  const moduleUrl = `${pathToFileURL(outfile).href}?ts=${Date.now()}`;
  const imported = await import(moduleUrl);

  return {
    module: imported,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

test("sensitive app policy keeps JS and TS rule behavior aligned across renderer and main-process surfaces", async () => {
  const jsModule = loadJsModule("src/config/sensitiveAppPolicy.js");
  const { module: tsModule, cleanup } = await loadTsModule("src/config/sensitiveAppPolicy.ts");

  try {
    const cases = [
      { appName: "1Password" },
      { appName: "Stripe Dashboard" },
      { appName: "Authy Desktop" },
      { appName: "支付宝" },
      { appName: "Notes" },
    ];

    for (const targetApp of cases) {
      const jsDecision = jsModule.resolveSensitiveAppPolicy({ targetApp });
      const tsDecision = tsModule.resolveSensitiveAppPolicy({ targetApp });

      assert.deepEqual(
        {
          matched: jsDecision.matched,
          action: jsDecision.action,
          ruleId: jsDecision.ruleId,
          blocksCloudReasoning: jsDecision.blocksCloudReasoning,
          blocksAutoLearn: jsDecision.blocksAutoLearn,
          blocksPasteMonitoring: jsDecision.blocksPasteMonitoring,
          blocksInjection: jsDecision.blocksInjection,
        },
        {
          matched: tsDecision.matched,
          action: tsDecision.action,
          ruleId: tsDecision.ruleId,
          blocksCloudReasoning: tsDecision.blocksCloudReasoning,
          blocksAutoLearn: tsDecision.blocksAutoLearn,
          blocksPasteMonitoring: tsDecision.blocksPasteMonitoring,
          blocksInjection: tsDecision.blocksInjection,
        },
        `policy mismatch for ${targetApp.appName}`
      );
    }
  } finally {
    cleanup();
  }
});
