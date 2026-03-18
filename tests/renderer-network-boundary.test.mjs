import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("preload, types, and ipc handlers expose a runtime API proxy for renderer requests", async () => {
  const [preloadSource, electronTypesSource, ipcHandlersSource] = await Promise.all([
    readRepoFile("preload.js"),
    readRepoFile("src/types/electron.ts"),
    readRepoFile("src/helpers/ipcHandlers.js"),
  ]);

  assert.match(
    preloadSource,
    /proxyRuntimeApiRequest:\s*\(request\)\s*=>\s*ipcRenderer\.invoke\("proxy-runtime-api-request", request\)/
  );
  assert.match(electronTypesSource, /proxyRuntimeApiRequest\??:\s*\(request:\s*\{/);
  assert.match(ipcHandlersSource, /ipcMain\.handle\("proxy-runtime-api-request", async/);
  assert.match(ipcHandlersSource, /performProxyHttpRequest/);
});

test("authentication and verification flows no longer use direct renderer fetch calls", async () => {
  const [authenticationSource, verificationSource, neonAuthSource] = await Promise.all([
    readRepoFile("src/components/AuthenticationStep.tsx"),
    readRepoFile("src/components/EmailVerificationStep.tsx"),
    readRepoFile("src/lib/neonAuth.ts"),
  ]);

  assert.match(authenticationSource, /window\.electronAPI\?\.proxyRuntimeApiRequest/);
  assert.match(verificationSource, /window\.electronAPI\?\.proxyRuntimeApiRequest/);
  assert.match(neonAuthSource, /window\.electronAPI\?\.proxyRuntimeApiRequest/);

  assert.doesNotMatch(authenticationSource, /fetch\(`\$\{MOUTHPIECE_API_URL\}\/api\/auth\/init-user/);
  assert.doesNotMatch(authenticationSource, /fetch\(`\$\{MOUTHPIECE_API_URL\}\/api\/check-user/);
  assert.doesNotMatch(verificationSource, /fetch\(url,\s*\{\s*credentials:\s*"include"/);
  assert.doesNotMatch(
    verificationSource,
    /fetch\(`\$\{MOUTHPIECE_API_URL\}\/api\/auth\/send-verification-email/
  );
  assert.match(
    neonAuthSource,
    /const isElectron = Boolean\(\(window as any\)\.electronAPI\);[\s\S]*proxyRuntimeApiRequest\(\{[\s\S]*target: "auth"[\s\S]*path: "\/sign-in\/social"/
  );
  assert.match(
    neonAuthSource,
    /window\.electronAPI\?\.proxyRuntimeApiRequest[\s\S]*proxyRuntimeApiRequest\(\{[\s\S]*target: "api"[\s\S]*path: "\/api\/auth\/forgot-password"/
  );
});

test("custom reasoning model discovery uses a main-process proxy instead of direct fetch", async () => {
  const source = await readRepoFile("src/components/ReasoningModelSelector.tsx");

  assert.match(source, /window\.electronAPI\?\.processCloudReasoningRequest/);
  assert.doesNotMatch(source, /const response = await fetch\(modelsUrl/);
});

test("control panel webPreferences return to secure defaults", async () => {
  const source = await readRepoFile("src/helpers/windowConfig.js");

  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webSecurity:\s*true/);
  assert.doesNotMatch(source, /sandbox:\s*false/);
  assert.doesNotMatch(source, /webSecurity:\s*false/);
});
