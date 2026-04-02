import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function loadHotkeyPersistenceModule() {
  try {
    return require(path.resolve(process.cwd(), "src/helpers/hotkeyPersistence.js"));
  } catch {
    return {};
  }
}

async function loadOnboardingFlowModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/onboardingFlow.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("platform defaults follow the new single-step hotkey rules", () => {
  const mod = loadHotkeyPersistenceModule();

  assert.equal(typeof mod.getDefaultHotkeyForPlatform, "function");
  assert.equal(mod.getDefaultHotkeyForPlatform("darwin"), "GLOBE");
  assert.equal(mod.getDefaultHotkeyForPlatform("win32"), "Control+K");
  assert.equal(mod.getDefaultHotkeyForPlatform("linux"), "Control+K");
});

test("hotkey startup restore prefers env first, then renderer storage, then the legacy renderer key, then platform defaults", () => {
  const mod = loadHotkeyPersistenceModule();

  assert.equal(typeof mod.resolvePersistedHotkey, "function");

  const envFirst = mod.resolvePersistedHotkey({
    envHotkey: "Alt+R",
    rendererDictationKey: "F8",
    rendererLegacyHotkey: "F9",
    platform: "linux",
  });
  assert.equal(envFirst.hotkey, "Alt+R");
  assert.equal(envFirst.source, "env");
  assert.equal(envFirst.needsRendererSync, true);
  assert.equal(envFirst.needsLegacyCleanup, true);

  const rendererFirst = mod.resolvePersistedHotkey({
    envHotkey: "",
    rendererDictationKey: "Control+Shift+Space",
    rendererLegacyHotkey: "F9",
    platform: "linux",
  });
  assert.equal(rendererFirst.hotkey, "Control+Shift+Space");
  assert.equal(rendererFirst.source, "renderer");
  assert.equal(rendererFirst.needsEnvSync, true);
  assert.equal(rendererFirst.needsLegacyCleanup, true);

  const legacyFallback = mod.resolvePersistedHotkey({
    envHotkey: "",
    rendererDictationKey: "",
    rendererLegacyHotkey: "F9",
    platform: "win32",
  });
  assert.equal(legacyFallback.hotkey, "F9");
  assert.equal(legacyFallback.source, "legacy-renderer");
  assert.equal(legacyFallback.needsEnvSync, true);
  assert.equal(legacyFallback.needsRendererSync, true);

  const platformDefault = mod.resolvePersistedHotkey({
    envHotkey: "",
    rendererDictationKey: "",
    rendererLegacyHotkey: "",
    platform: "darwin",
  });
  assert.equal(platformDefault.hotkey, "GLOBE");
  assert.equal(platformDefault.source, "default");
});

test("onboarding hotkey draft follows a late-hydrated saved hotkey until the user explicitly edits it", async () => {
  const mod = await loadOnboardingFlowModule();

  assert.equal(typeof mod.resolveOnboardingHotkeyDraft, "function");

  assert.equal(
    mod.resolveOnboardingHotkeyDraft({
      draftHotkey: "Control+Super",
      settingsHotkey: "Alt+R",
      hasUserEdited: false,
      fallbackHotkey: "Control+Super",
    }),
    "Alt+R"
  );

  assert.equal(
    mod.resolveOnboardingHotkeyDraft({
      draftHotkey: "F8",
      settingsHotkey: "Alt+R",
      hasUserEdited: true,
      fallbackHotkey: "Control+Super",
    }),
    "F8"
  );
});

test("GNOME startup restore reuses the shared persisted hotkey resolver instead of reading only dictationKey directly", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/hotkeyManager.js"),
    "utf8"
  );

  assert.match(source, /resolvePersistedHotkey/);
  assert.match(source, /localStorage\.getItem\("hotkey"\)/);
  assert.doesNotMatch(
    source,
    /const savedHotkey = await mainWindow\.webContents\.executeJavaScript\(\s*`[\s\S]*localStorage\.getItem\("dictationKey"\) \|\| ""[\s\S]*`\s*\);/
  );
});
