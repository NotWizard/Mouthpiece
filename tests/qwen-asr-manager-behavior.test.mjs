import test from "node:test";
import assert from "node:assert/strict";

import QwenAsrManager from "../src/helpers/qwenAsr.js";
import QwenAsrServerManager from "../src/helpers/qwenAsrServer.js";

function withProcessPlatform(platform, arch, fn) {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalArch = Object.getOwnPropertyDescriptor(process, "arch");

  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  Object.defineProperty(process, "arch", { value: arch, configurable: true });

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      Object.defineProperty(process, "platform", originalPlatform);
      Object.defineProperty(process, "arch", originalArch);
    });
}

test("Qwen ASR reports unavailable on non Apple Silicon platforms", async () => {
  await withProcessPlatform("linux", "x64", async () => {
    const manager = new QwenAsrManager();
    const status = await manager.checkInstallation();

    assert.equal(status.supported, false);
    assert.equal(status.working, false);
    assert.match(status.message, /Apple Silicon macOS/);
  });
});

test("Qwen ASR install surfaces missing Python before touching runtime", async () => {
  await withProcessPlatform("darwin", "arm64", async () => {
    const manager = new QwenAsrManager();
    manager.findPythonCandidate = () => null;

    const status = await manager.installRuntime();

    assert.equal(status.success, false);
    assert.match(status.error, /Python 3\.10/);
  });
});

test("Qwen ASR server status reflects availability, readiness, and selected model", () => {
  const server = new QwenAsrServerManager();
  server.ready = true;
  server.process = { pid: 1234 };
  server.port = 6031;
  server.modelName = "qwen3-asr-0.6b-mlx";
  server.getExecutablePath = () => "/tmp/mlx-qwen3-asr";

  const status = server.getServerStatus();

  assert.equal(status.available, true);
  assert.equal(status.running, true);
  assert.equal(status.ready, true);
  assert.equal(status.port, 6031);
  assert.equal(status.modelName, "qwen3-asr-0.6b-mlx");
});

test("Qwen ASR server restarts when switching models", async () => {
  const server = new QwenAsrServerManager();
  let stopped = false;
  let startedModel = null;

  server.ready = true;
  server.process = { pid: 1234 };
  server.modelName = "qwen3-asr-0.6b-mlx";
  server.stopServer = async () => {
    stopped = true;
    server.ready = false;
    server.process = null;
  };
  server._doStartServer = async (modelName) => {
    startedModel = modelName;
    server.ready = true;
    server.process = { pid: 5678 };
    server.modelName = modelName;
    server.port = 6032;
    return { success: true, port: 6032 };
  };

  const result = await server.startServer("qwen3-asr-1.7b-mlx");

  assert.equal(stopped, true);
  assert.equal(startedModel, "qwen3-asr-1.7b-mlx");
  assert.deepEqual(result, { success: true, port: 6032 });
});
