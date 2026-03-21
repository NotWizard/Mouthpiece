import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadModule(relativePath) {
  return require(path.resolve(process.cwd(), relativePath));
}

test("sensitive app policy blocks injection for password managers and cloud reasoning for finance surfaces", () => {
  const mod = loadModule("src/config/sensitiveAppPolicy.js");

  const passwordManager = mod.resolveSensitiveAppPolicy({
    targetApp: { appName: "1Password" },
  });
  const financeSurface = mod.resolveSensitiveAppPolicy({
    targetApp: { appName: "Stripe Dashboard" },
  });

  assert.equal(passwordManager.matched, true);
  assert.equal(passwordManager.action, "block_injection");
  assert.equal(passwordManager.blocksInjection, true);
  assert.equal(financeSurface.matched, true);
  assert.equal(financeSurface.blocksCloudReasoning, true);
  assert.equal(financeSurface.blocksAutoLearn, true);
  assert.equal(financeSurface.blocksPasteMonitoring, true);
});

test("sensitive app policy honors explicit overrides", () => {
  const mod = loadModule("src/config/sensitiveAppPolicy.js");

  const decision = mod.resolveSensitiveAppPolicy({
    targetApp: { appName: "1Password" },
    allowInjection: true,
    allowCloudReasoning: true,
    allowAutoLearn: true,
    allowPasteMonitoring: true,
  });

  assert.equal(decision.action, "allow_full_pipeline");
  assert.equal(decision.blocksInjection, false);
  assert.equal(decision.blocksCloudReasoning, false);
});

test("audio manager and paste IPC consult sensitive app policy before cloud reasoning and monitoring", async () => {
  const [audioManagerSource, ipcHandlersSource] = await Promise.all([
    fs.readFile(path.resolve(process.cwd(), "src/helpers/audioManager.js"), "utf8"),
    fs.readFile(path.resolve(process.cwd(), "src/helpers/ipcHandlers.js"), "utf8"),
  ]);

  assert.match(audioManagerSource, /resolveSensitiveAppPolicy/);
  assert.match(audioManagerSource, /blocksCloudReasoning/);
  assert.match(ipcHandlersSource, /blocksInjection/);
  assert.match(ipcHandlersSource, /blocksAutoLearn/);
  assert.match(ipcHandlersSource, /blocksPasteMonitoring/);
});
