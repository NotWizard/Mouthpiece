import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadDiscoveryModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/providerModelDiscovery.mjs")
  ).href;
  return import(modulePath);
}

test("provider model discovery builds provider-specific authenticated requests", async () => {
  const {
    createProviderModelDiscoveryRequest,
    MODEL_DISCOVERY_DEFAULT_BASE_URLS,
    MODEL_DISCOVERY_PROVIDER_CAPABILITIES,
  } = await loadDiscoveryModule();

  assert.equal(MODEL_DISCOVERY_PROVIDER_CAPABILITIES.deepgram.supportsDiscovery, true);
  assert.equal(MODEL_DISCOVERY_PROVIDER_CAPABILITIES.soniox.supportsDiscovery, true);

  assert.deepEqual(
    createProviderModelDiscoveryRequest({
      providerId: "anthropic",
      purpose: "reasoning",
      apiKey: "anthropic-key",
    }),
    {
      endpoint: "https://api.anthropic.com/v1/models",
      method: "GET",
      headers: {
        "x-api-key": "anthropic-key",
        "anthropic-version": "2023-06-01",
      },
      timeoutMs: 15000,
    }
  );

  assert.deepEqual(
    createProviderModelDiscoveryRequest({
      providerId: "gemini",
      purpose: "reasoning",
      apiKey: "gemini-key",
    }),
    {
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
      method: "GET",
      headers: {
        "x-goog-api-key": "gemini-key",
      },
      timeoutMs: 15000,
    }
  );

  assert.equal(
    createProviderModelDiscoveryRequest({
      providerId: "deepgram",
      purpose: "transcription",
      apiKey: "deepgram-key",
    }).headers.Authorization,
    "Token deepgram-key"
  );

  assert.equal(
    createProviderModelDiscoveryRequest({
      providerId: "bailian",
      purpose: "transcription",
      apiKey: "bailian-key",
    }).endpoint,
    `${MODEL_DISCOVERY_DEFAULT_BASE_URLS.bailian}/models`
  );
});

test("provider model discovery normalizes OpenAI-compatible, Gemini, Deepgram, and Soniox payloads", async () => {
  const { normalizeProviderModelResponse } = await loadDiscoveryModule();

  assert.deepEqual(
    normalizeProviderModelResponse({
      providerId: "openai",
      purpose: "transcription",
      payload: {
        data: [
          { id: "gpt-4o-mini-transcribe", owned_by: "openai" },
          { id: "gpt-5.2", owned_by: "openai" },
          { id: "whisper-1", owned_by: "openai" },
        ],
      },
    }).map((model) => model.value),
    ["gpt-4o-mini-transcribe", "whisper-1"]
  );

  assert.deepEqual(
    normalizeProviderModelResponse({
      providerId: "gemini",
      purpose: "reasoning",
      payload: {
        models: [
          {
            name: "models/gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            supportedGenerationMethods: ["generateContent"],
          },
          {
            name: "models/embedding-001",
            displayName: "Embedding",
            supportedGenerationMethods: ["embedContent"],
          },
        ],
      },
    }),
    [
      {
        value: "gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        description: undefined,
        ownedBy: undefined,
      },
    ]
  );

  assert.deepEqual(
    normalizeProviderModelResponse({
      providerId: "deepgram",
      purpose: "transcription",
      payload: {
        stt: [
          {
            name: "nova-3",
            canonical_name: "nova-3",
            batch: true,
            streaming: true,
            languages: ["en", "zh"],
          },
        ],
      },
    }),
    [
      {
        value: "nova-3",
        label: "nova-3",
        description: "Batch + realtime · en, zh",
        ownedBy: undefined,
      },
    ]
  );

  assert.deepEqual(
    normalizeProviderModelResponse({
      providerId: "soniox",
      purpose: "transcription",
      payload: {
        models: [{ id: "stt-rt-v4", name: "Speech-to-Text Real-time v4" }],
      },
    }),
    [
      {
        value: "stt-rt-v4",
        label: "Speech-to-Text Real-time v4",
        description: undefined,
        ownedBy: undefined,
      },
    ]
  );
});

test("provider model discovery keeps only trunk Qwen ASR models for Bailian transcription", async () => {
  const { normalizeProviderModelResponse } = await loadDiscoveryModule();

  assert.deepEqual(
    normalizeProviderModelResponse({
      providerId: "bailian",
      purpose: "transcription",
      payload: {
        data: [
          { id: "qwen3-asr-flash" },
          { id: "qwen3-asr-flash-realtime" },
          { id: "qwen3-asr-flash-2026-02-10" },
          { id: "qwen3-asr-flash-2025-09-08" },
          { id: "qwen3.5-flash" },
        ],
      },
    }).map((model) => model.value),
    ["qwen3-asr-flash", "qwen3-asr-flash-realtime"]
  );
});

test("provider model discovery derives Bailian Qwen ASR trunk aliases from snapshot-only responses", async () => {
  const { normalizeProviderModelResponse } = await loadDiscoveryModule();

  const models = normalizeProviderModelResponse({
    providerId: "bailian",
    purpose: "transcription",
    payload: {
      data: [
        { id: "qwen3-asr-flash-realtime", owned_by: "system" },
        { id: "qwen3-asr-flash-2026-02-10", owned_by: "system" },
        { id: "qwen3-asr-flash-2025-09-08", owned_by: "system" },
      ],
    },
  });

  assert.deepEqual(
    models.map((model) => model.value),
    ["qwen3-asr-flash", "qwen3-asr-flash-realtime"]
  );
  assert.deepEqual(
    models.map((model) => model.label),
    ["qwen3-asr-flash", "qwen3-asr-flash-realtime"]
  );
});

test("provider model discovery labels Bailian realtime snapshot aliases as trunk models", async () => {
  const { normalizeProviderModelResponse } = await loadDiscoveryModule();

  assert.deepEqual(
    normalizeProviderModelResponse({
      providerId: "bailian",
      purpose: "transcription",
      payload: {
        data: [{ id: "qwen3-asr-flash-realtime-2026-02-10", owned_by: "system" }],
      },
    }).map((model) => ({ value: model.value, label: model.label })),
    [{ value: "qwen3-asr-flash-realtime", label: "qwen3-asr-flash-realtime" }]
  );
});

test("provider model discovery summarizes fetch failures without leaking API keys", async () => {
  const { createModelDiscoveryErrorMessage } = await loadDiscoveryModule();

  assert.equal(
    createModelDiscoveryErrorMessage({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: '{"error":"bad key secret-value"}',
      json: null,
    }),
    "401 Unauthorized"
  );

  assert.equal(
    createModelDiscoveryErrorMessage(new Error("Request timed out after 15s")),
    "Request timed out after 15s"
  );
});

test("provider model discovery cache keys change when API keys change without exposing secrets", async () => {
  const { createProviderModelDiscoveryCacheKey } = await loadDiscoveryModule();

  const firstKey = createProviderModelDiscoveryCacheKey({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-first-secret",
  });
  const secondKey = createProviderModelDiscoveryCacheKey({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-second-secret",
  });
  const publicKey = createProviderModelDiscoveryCacheKey({
    providerId: "openai",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
  });

  assert.notEqual(firstKey, secondKey);
  assert.notEqual(firstKey, publicKey);
  assert.doesNotMatch(firstKey, /sk-first-secret/);
  assert.doesNotMatch(secondKey, /sk-second-secret/);
});
