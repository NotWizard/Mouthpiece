import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadProfilesModule() {
  return require(path.resolve(process.cwd(), "src/config/insertionCompatibilityProfiles.js"));
}

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("compatibility profiles resolve chat and terminal families with distinct fallback posture", () => {
  const mod = loadProfilesModule();

  const chat = mod.resolveInsertionCompatibilityProfile({
    targetApp: { appName: "Slack" },
  });
  const terminal = mod.resolveInsertionCompatibilityProfile({
    targetApp: { appName: "Cursor" },
  });

  assert.equal(chat.id, "chat_app");
  assert.equal(chat.fallback.feedbackCode, "chat_manual_paste");
  assert.equal(terminal.id, "terminal_ide");
  assert.equal(terminal.fallback.downgradeUnverifiedAutoPaste, true);
  assert.equal(terminal.expectedInsertionMode, "manual_review");
});

test("generic compatibility profile remains available for unknown apps", () => {
  const mod = loadProfilesModule();

  const profile = mod.resolveInsertionCompatibilityProfile({
    targetApp: { appName: "Some Custom CRM" },
  });

  assert.equal(profile.id, "generic");
  assert.equal(profile.retry.autoPasteAttempts, 2);
  assert.equal(profile.fallback.allowClipboardCopy, true);
});

test("clipboard flow consults compatibility profiles and emits stable fallback metadata", async () => {
  const source = await readRepoFile("src/helpers/clipboard.js");

  assert.match(source, /resolveInsertionCompatibilityProfile/);
  assert.match(source, /compatibilityProfileId/);
  assert.match(source, /feedbackCode/);
  assert.match(source, /retryCount/);
});
