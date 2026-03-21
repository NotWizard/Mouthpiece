import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadModule(relativePath) {
  return require(path.resolve(process.cwd(), relativePath));
}

test("log redaction masks transcript-like payloads and api keys recursively", () => {
  const mod = loadModule("src/utils/logRedaction.js");

  const redacted = mod.redactLogMeta({
    transcript: "send the quarterly numbers to alice",
    clipboardText: "super secret clipboard payload",
    headers: {
      Authorization: "Bearer secret-token",
    },
    openaiApiKey: "sk-example-secret-key",
    targetApp: {
      appName: "Slack",
    },
  });

  assert.equal(redacted.transcript, "[REDACTED_TEXT]");
  assert.equal(redacted.clipboardText, "[REDACTED_TEXT]");
  assert.equal(redacted.headers.Authorization, "[REDACTED_SECRET]");
  assert.equal(redacted.openaiApiKey, "[REDACTED_SECRET]");
  assert.equal(redacted.targetApp.appName, "Slack");
});

test("debug logger routes entries through the redaction helper", async () => {
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/debugLogger.js"),
    "utf8"
  );

  assert.match(source, /redactLogEntry/);
  assert.match(source, /redactLogMeta/);
});
