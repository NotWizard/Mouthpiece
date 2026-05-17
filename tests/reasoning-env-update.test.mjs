import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function loadModule() {
  return require(path.resolve(process.cwd(), "src/helpers/reasoningEnvUpdate.js"));
}

test("computeReasoningEnvUpdate persists local provider and model", () => {
  const { computeReasoningEnvUpdate } = loadModule();
  const result = computeReasoningEnvUpdate({
    reasoningProvider: "local",
    reasoningModel: "qwen2.5-7b",
  });
  assert.deepEqual(result.setVars, {
    REASONING_PROVIDER: "local",
    LOCAL_REASONING_MODEL: "qwen2.5-7b",
  });
  assert.deepEqual(result.clearVars, []);
  assert.equal(result.stopLlamaServer, false);
});

test("computeReasoningEnvUpdate persists cloud provider and clears local model", () => {
  const { computeReasoningEnvUpdate } = loadModule();
  const result = computeReasoningEnvUpdate({
    reasoningProvider: "anthropic",
    reasoningModel: "",
  });
  assert.equal(result.setVars.REASONING_PROVIDER, "anthropic");
  assert.ok(result.clearVars.includes("LOCAL_REASONING_MODEL"));
  assert.equal(result.stopLlamaServer, true);
});

test("computeReasoningEnvUpdate clears env and stops llama-server when provider is empty", () => {
  const { computeReasoningEnvUpdate } = loadModule();
  for (const empty of ["", null, undefined]) {
    const result = computeReasoningEnvUpdate({ reasoningProvider: empty });
    assert.deepEqual(result.setVars, {}, `empty=${String(empty)}`);
    assert.ok(
      result.clearVars.includes("REASONING_PROVIDER"),
      `empty=${String(empty)} should clear REASONING_PROVIDER`
    );
    assert.ok(
      result.clearVars.includes("LOCAL_REASONING_MODEL"),
      `empty=${String(empty)} should clear LOCAL_REASONING_MODEL`
    );
    assert.equal(
      result.stopLlamaServer,
      true,
      `empty=${String(empty)} should request llama-server stop`
    );
  }
});

test("computeReasoningEnvUpdate does not require reasoningModel for cloud providers", () => {
  const { computeReasoningEnvUpdate } = loadModule();
  for (const provider of ["openai", "anthropic", "gemini"]) {
    const result = computeReasoningEnvUpdate({ reasoningProvider: provider });
    assert.equal(
      result.setVars.REASONING_PROVIDER,
      provider,
      `cloud provider ${provider} should persist to env`
    );
  }
});

test("computeReasoningEnvUpdate clears LOCAL_REASONING_MODEL when local provider lacks model", () => {
  const { computeReasoningEnvUpdate } = loadModule();
  const result = computeReasoningEnvUpdate({ reasoningProvider: "local", reasoningModel: "" });
  assert.equal(result.setVars.REASONING_PROVIDER, "local");
  assert.ok(result.clearVars.includes("LOCAL_REASONING_MODEL"));
  assert.equal(result.stopLlamaServer, false);
});
