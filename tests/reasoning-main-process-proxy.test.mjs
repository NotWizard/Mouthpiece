import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("preload and electron types expose a main-process cloud reasoning request proxy", async () => {
  const [preloadSource, electronTypesSource] = await Promise.all([
    readRepoFile("preload.js"),
    readRepoFile("src/types/electron.ts"),
  ]);

  assert.match(
    preloadSource,
    /processCloudReasoningRequest:\s*\(request\)\s*=>\s*ipcRenderer\.invoke\("process-cloud-reasoning-request", request\)/
  );
  assert.match(
    electronTypesSource,
    /processCloudReasoningRequest\??:\s*\(request:\s*\{[\s\S]*endpoint:\s*string;[\s\S]*timeoutMs\??:\s*number;[\s\S]*\}\)\s*=>\s*Promise<\{[\s\S]*ok:\s*boolean;/
  );
});

test("main process and reasoning service wire the cloud reasoning proxy", async () => {
  const [ipcHandlersSource, reasoningSource] = await Promise.all([
    readRepoFile("src/helpers/ipcHandlers.js"),
    readRepoFile("src/services/ReasoningService.ts"),
  ]);

  assert.match(ipcHandlersSource, /ipcMain\.handle\("process-cloud-reasoning-request", async/);
  assert.match(reasoningSource, /window\.electronAPI\?\.processCloudReasoningRequest/);
  assert.match(reasoningSource, /private async performCloudReasoningRequest/);
});
