import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

function createLocalStorage(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries));

  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

async function loadReasoningService({
  storage = {},
  electronAPI = {},
} = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mouthpiece-reasoning-test-"));
  const outfile = path.join(tempDir, "ReasoningService.bundle.mjs");

  await esbuild.build({
    entryPoints: [path.resolve(process.cwd(), "src/services/ReasoningService.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    outfile,
    logLevel: "silent",
  });

  const localStorage = createLocalStorage({
    uiLanguage: "zh-CN",
    cloudReasoningMode: "byok",
    reasoningProvider: "custom",
    reasoningModel: "qwen3.5-flash",
    cloudReasoningBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ...storage,
  });

  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;

  globalThis.window = {
    localStorage,
    addEventListener() {},
    dispatchEvent() {},
    electronAPI: {
      getOpenAIKey: async () => "",
      getAnthropicKey: async () => "",
      getGeminiKey: async () => "",
      getGroqKey: async () => "",
      getCustomReasoningKey: async () => "",
      checkLocalReasoningAvailable: async () => false,
      ...electronAPI,
    },
  };
  globalThis.localStorage = localStorage;

  const moduleUrl = `${pathToFileURL(outfile).href}?ts=${Date.now()}`;
  const imported = await import(moduleUrl);
  const service = imported.default;

  return {
    service,
    cleanup() {
      service?.destroy?.();
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

test("custom reasoning provider counts as available when a custom API key is configured", async () => {
  const { service, cleanup } = await loadReasoningService({
    storage: {
      customReasoningApiKey: "sk-test-custom",
    },
    electronAPI: {
      getCustomReasoningKey: async () => "sk-test-custom",
    },
  });

  try {
    assert.equal(await service.isAvailable(), true);
  } finally {
    cleanup();
  }
});

test("custom reasoning tries responses before falling back to chat completions for custom endpoints", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      body,
      headers: options.headers || {},
    });

    if (String(url).endsWith("/responses")) {
      return new Response(JSON.stringify({ error: { message: "not supported" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "我在上海没有亲戚朋友。" } }],
        usage: { total_tokens: 42 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const { service, cleanup } = await loadReasoningService({
    storage: {
      customReasoningApiKey: "sk-test-custom",
      preferredLanguage: "zh-CN",
      customUnifiedPrompt: JSON.stringify("PROMPT::{{agentName}}::CUSTOM"),
    },
    electronAPI: {
      getCustomReasoningKey: async () => "sk-test-custom",
    },
  });

  try {
    const result = await service.processText("嗯，我上海没亲戚朋友。", "qwen3.5-flash", "AI", {
      contextClassification: {
        context: "general",
        intent: "cleanup",
        confidence: 0.9,
        strictMode: true,
        strictOverlapThreshold: 0.72,
        signals: [],
        targetApp: {
          appName: "Notes",
          processId: 1,
          platform: "darwin",
          source: "renderer-fallback",
          capturedAt: null,
        },
      },
      strictMode: true,
      strictOverlapThreshold: 0.86,
    });

    assert.equal(result, "我在上海没有亲戚朋友。");
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/responses"
    );
    assert.equal(
      requests[1].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    assert.equal(requests[1].body.enable_thinking, false);
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
  }
});

test("custom reasoning ignores stored chat endpoint preference and still probes responses first", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      body,
      headers: options.headers || {},
    });

    if (String(url).endsWith("/responses")) {
      return new Response(JSON.stringify({ error: { message: "not supported" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "我在上海没有亲戚朋友。" } }],
        usage: { total_tokens: 42 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const baseUrl = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const { service, cleanup } = await loadReasoningService({
    storage: {
      customReasoningApiKey: "sk-test-custom",
      preferredLanguage: "zh-CN",
      cloudReasoningBaseUrl: baseUrl,
      customUnifiedPrompt: JSON.stringify("PROMPT::{{agentName}}::CUSTOM"),
      openAiEndpointPreference: JSON.stringify({
        [baseUrl]: "chat",
      }),
    },
    electronAPI: {
      getCustomReasoningKey: async () => "sk-test-custom",
    },
  });

  try {
    const result = await service.processText("嗯，我上海没亲戚朋友。", "qwen3.5-flash", "AI", {
      contextClassification: {
        context: "general",
        intent: "cleanup",
        confidence: 0.9,
        strictMode: true,
        strictOverlapThreshold: 0.72,
        signals: [],
        targetApp: {
          appName: "Notes",
          processId: 1,
          platform: "darwin",
          source: "renderer-fallback",
          capturedAt: null,
        },
      },
      strictMode: true,
      strictOverlapThreshold: 0.86,
    });

    assert.equal(result, "我在上海没有亲戚朋友。");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, `${baseUrl}/responses`);
    assert.equal(requests[1].url, `${baseUrl}/chat/completions`);
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
  }
});

test("custom reasoning falls back to chat completions when responses times out", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      body,
      headers: options.headers || {},
    });

    if (String(url).endsWith("/responses")) {
      const error = new Error("simulated timeout");
      error.name = "AbortError";
      throw error;
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "我在上海没有亲戚朋友。" } }],
        usage: { total_tokens: 42 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const { service, cleanup } = await loadReasoningService({
    storage: {
      customReasoningApiKey: "sk-test-custom",
      preferredLanguage: "zh-CN",
      cloudReasoningBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    electronAPI: {
      getCustomReasoningKey: async () => "sk-test-custom",
    },
  });

  try {
    const result = await service.processText("嗯，我上海没亲戚朋友。", "qwen3.5-flash", "AI", {
      contextClassification: {
        context: "general",
        intent: "cleanup",
        confidence: 0.9,
        strictMode: true,
        strictOverlapThreshold: 0.72,
        signals: [],
        targetApp: {
          appName: "Notes",
          processId: 1,
          platform: "darwin",
          source: "renderer-fallback",
          capturedAt: null,
        },
      },
      strictMode: true,
      strictOverlapThreshold: 0.86,
    });

    assert.equal(result, "我在上海没有亲戚朋友。");
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/responses"
    );
    assert.equal(
      requests[1].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
  }
});

test("custom reasoning can explicitly enable thinking for chat completions", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      body,
      headers: options.headers || {},
    });

    if (String(url).endsWith("/responses")) {
      return new Response(JSON.stringify({ error: { message: "not supported" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "我在上海没有亲戚朋友。" } }],
        usage: { total_tokens: 42 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const { service, cleanup } = await loadReasoningService({
    storage: {
      customReasoningApiKey: "sk-test-custom",
      customReasoningEnableThinking: "true",
      preferredLanguage: "zh-CN",
      cloudReasoningBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    electronAPI: {
      getCustomReasoningKey: async () => "sk-test-custom",
    },
  });

  try {
    const result = await service.processText("嗯，我上海没亲戚朋友。", "qwen3.5-flash", "AI", {
      contextClassification: {
        context: "general",
        intent: "cleanup",
        confidence: 0.9,
        strictMode: true,
        strictOverlapThreshold: 0.72,
        signals: [],
        targetApp: {
          appName: "Notes",
          processId: 1,
          platform: "darwin",
          source: "renderer-fallback",
          capturedAt: null,
        },
      },
      strictMode: true,
      strictOverlapThreshold: 0.86,
    });

    assert.equal(result, "我在上海没有亲戚朋友。");
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    assert.equal(requests[1].body.enable_thinking, true);
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
  }
});

test("custom reasoning keeps Chinese cleanup output when the API returns a polished rewrite", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      body,
      headers: options.headers || {},
    });

    if (String(url).endsWith("/responses")) {
      return new Response(JSON.stringify({ error: { message: "not supported" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "我在上海没有亲戚朋友。" } }],
        usage: { total_tokens: 42 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const { service, cleanup } = await loadReasoningService({
    storage: {
      customReasoningApiKey: "sk-test-custom",
      voiceAssistantEnabled: "true",
      preferredLanguage: "zh-CN",
      customUnifiedPrompt: JSON.stringify("PROMPT::{{agentName}}::CUSTOM"),
    },
    electronAPI: {
      getCustomReasoningKey: async () => "sk-test-custom",
    },
  });

  try {
    const result = await service.processText("嗯，我上海没亲戚朋友。", "qwen3.5-flash", "AI", {
      contextClassification: {
        context: "general",
        intent: "cleanup",
        confidence: 0.9,
        strictMode: true,
        strictOverlapThreshold: 0.72,
        signals: [],
        targetApp: {
          appName: "Notes",
          processId: 1,
          platform: "darwin",
          source: "renderer-fallback",
          capturedAt: null,
        },
      },
      strictMode: true,
      strictOverlapThreshold: 0.86,
    });

    assert.equal(result, "我在上海没有亲戚朋友。");
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/responses"
    );
    assert.equal(
      requests[1].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    assert.equal(requests[1].headers.Authorization, "Bearer sk-test-custom");
    assert.match(requests[1].body.messages[0].content, /PROMPT::AI::CUSTOM/);
    assert.equal(requests[1].body.messages[1].content, "嗯，我上海没亲戚朋友。");
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
  }
});

test("bailian reasoning goes straight to chat completions with thinking disabled by default", async () => {
  const requests = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({
      url: String(url),
      body,
      headers: options.headers || {},
    });

    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "现在这个胶囊的样式没问题了，恢复正常了。" } }],
        usage: { total_tokens: 36 },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  };

  const { service, cleanup } = await loadReasoningService({
    storage: {
      reasoningProvider: "bailian",
      bailianApiKey: "sk-test-bailian",
      reasoningModel: "qwen3.5-flash",
      customUnifiedPrompt: JSON.stringify("PROMPT::{{agentName}}::CUSTOM"),
    },
    electronAPI: {
      getBailianKey: async () => "sk-test-bailian",
    },
  });

  try {
    const result = await service.processText(
      "请把这句话润色得更自然，但不要改变原意：现在这个胶囊的样式没有问题了，正常了。",
      "qwen3.5-flash",
      "AI",
      {
        contextClassification: {
          context: "general",
          intent: "cleanup",
          confidence: 0.9,
          strictMode: true,
          strictOverlapThreshold: 0.72,
          signals: [],
          targetApp: {
            appName: "Notes",
            processId: 1,
            platform: "darwin",
            source: "renderer-fallback",
            capturedAt: null,
          },
        },
        strictMode: true,
        strictOverlapThreshold: 0.86,
      }
    );

    assert.equal(
      result,
      "请把这句话润色得更自然，但不要改变原意：现在这个胶囊的样式没有问题了，正常了。"
    );
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"
    );
    assert.equal(requests[0].body.enable_thinking, false);
    assert.equal(requests[0].body.model, "qwen3.5-flash");
  } finally {
    globalThis.fetch = previousFetch;
    cleanup();
  }
});
