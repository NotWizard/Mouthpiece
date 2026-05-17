import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadEnvFileModule() {
  return require(path.resolve(process.cwd(), "src/helpers/envFile.js"));
}

test("mergeEnvFile preserves unknown keys outside the persisted allow-list", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const existing = "DICTATION_KEY=foo\nMY_DEV_TOOL=bar\n";
  const merged = mergeEnvFile({
    existingContent: existing,
    processEnv: { DICTATION_KEY: "RightCommand" },
    persistedKeys: ["DICTATION_KEY"],
  });
  assert.match(merged, /DICTATION_KEY=RightCommand/);
  assert.match(merged, /MY_DEV_TOOL=bar/);
});

test("mergeEnvFile keeps comment lines verbatim", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const existing = "# user note\n# another comment\nDICTATION_KEY=foo\n";
  const merged = mergeEnvFile({
    existingContent: existing,
    processEnv: { DICTATION_KEY: "Globe" },
    persistedKeys: ["DICTATION_KEY"],
  });
  assert.match(merged, /^# user note$/m);
  assert.match(merged, /^# another comment$/m);
});

test("mergeEnvFile removes a persisted key when processEnv lacks it", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const existing = "DICTATION_KEY=foo\nOPENAI_API_KEY=sk-test\n";
  const merged = mergeEnvFile({
    existingContent: existing,
    processEnv: { OPENAI_API_KEY: "sk-test" },
    persistedKeys: ["DICTATION_KEY", "OPENAI_API_KEY"],
  });
  assert.doesNotMatch(merged, /^DICTATION_KEY=/m);
  assert.match(merged, /OPENAI_API_KEY=sk-test/);
});

test("mergeEnvFile appends persisted keys missing in the existing file", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const merged = mergeEnvFile({
    existingContent: "",
    processEnv: { DICTATION_KEY: "RightCommand" },
    persistedKeys: ["DICTATION_KEY"],
  });
  assert.match(merged, /DICTATION_KEY=RightCommand/);
});

test("mergeEnvFile retains QWEN_ASR_MODEL when included in persisted keys", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const merged = mergeEnvFile({
    existingContent: "",
    processEnv: { QWEN_ASR_MODEL: "qwen-2.5b" },
    persistedKeys: ["QWEN_ASR_MODEL"],
  });
  assert.match(merged, /QWEN_ASR_MODEL=qwen-2.5b/);
});

test("mergeEnvFile updates an existing persisted key in place", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const existing = "DICTATION_KEY=oldvalue\nMY_OTHER=keep\n";
  const merged = mergeEnvFile({
    existingContent: existing,
    processEnv: { DICTATION_KEY: "newvalue" },
    persistedKeys: ["DICTATION_KEY"],
  });
  assert.match(merged, /DICTATION_KEY=newvalue/);
  assert.doesNotMatch(merged, /DICTATION_KEY=oldvalue/);
  assert.match(merged, /MY_OTHER=keep/);
});

test("mergeEnvFile is idempotent on no-op input", () => {
  const { mergeEnvFile } = loadEnvFileModule();
  const existing = "DICTATION_KEY=foo\n";
  const first = mergeEnvFile({
    existingContent: existing,
    processEnv: { DICTATION_KEY: "foo" },
    persistedKeys: ["DICTATION_KEY"],
  });
  const second = mergeEnvFile({
    existingContent: first,
    processEnv: { DICTATION_KEY: "foo" },
    persistedKeys: ["DICTATION_KEY"],
  });
  assert.equal(first, second);
});
