import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBundledModule } from "./helpers/load-bundled-module.mjs";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("prompt resolution no longer switches into assistant mode", async () => {
  const source = await readRepoFile("src/config/prompts.ts");

  assert.doesNotMatch(source, /voiceAssistantEnabled/);
  assert.doesNotMatch(source, /reasoningEnableAgentMode/);
  assert.doesNotMatch(source, /useFullPrompt/);
  assert.doesNotMatch(source, /detectAgentName/);
  assert.doesNotMatch(source, /FULL_PROMPT/);
  assert.doesNotMatch(source, /LEGACY_PROMPTS/);
  assert.doesNotMatch(source, /fullPrompt/);
  assert.doesNotMatch(source, /customUnifiedPrompt/);
  assert.doesNotMatch(source, /agentName/);
});

test("audio cleanup pipeline no longer branches on voice assistant mode", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.doesNotMatch(source, /AGENT_WAKE_PHRASE_DETECTED/);
  assert.doesNotMatch(source, /voiceAssistantEnabled/);
  assert.doesNotMatch(source, /agentName/);
  assert.doesNotMatch(source, /hasAgentDirectAddress/);
  assert.doesNotMatch(source, /intent:\s*"instruction"/);
});

test("settings page no longer renders agent configuration controls", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.doesNotMatch(source, /case "agentConfig"/);
  assert.doesNotMatch(source, /settingsPage\.agentConfig\./);
  assert.doesNotMatch(source, /voiceAssistantToggle/);
  assert.doesNotMatch(source, /Voice Agent/);
});

test("dictation overlay no longer depends on a custom agent name", async () => {
  const [appSource, capsuleSource, onboardingSource] = await Promise.all([
    readRepoFile("src/App.jsx"),
    readRepoFile("src/components/DictationCapsule.tsx"),
    readRepoFile("src/components/OnboardingFlow.tsx"),
  ]);

  assert.doesNotMatch(appSource, /getAgentName/);
  assert.doesNotMatch(capsuleSource, /agentName:/);
  assert.doesNotMatch(onboardingSource, /saveAgentName|getAgentName/);
});

test("agent direct address matcher module is removed", async () => {
  await assert.rejects(
    fs.access(path.resolve(process.cwd(), "src/utils/agentDirectAddress.mjs")),
    /ENOENT/
  );
});

test("voice content cannot start dictation", async () => {
  const [appSource, audioSource, hotkeySource] = await Promise.all([
    readRepoFile("src/App.jsx"),
    readRepoFile("src/helpers/audioManager.js"),
    readRepoFile("src/helpers/hotkeyManager.js"),
  ]);

  assert.match(appSource, /toggleListening\(\)/);
  assert.match(hotkeySource, /toggle|start|stop/i);
  assert.doesNotMatch(audioSource, /hasAgentDirectAddress/);
  assert.doesNotMatch(audioSource, /direct address/i);
  assert.doesNotMatch(audioSource, /start.*listening/i);
});

test("legacy agent storage keys are scrubbed during settings initialization", async () => {
  const [settingsSource, storageSource] = await Promise.all([
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/utils/promptStorage.ts"),
  ]);

  assert.match(settingsSource, /migrateLegacyVoiceModeStorage\(localStorage\)/);
  assert.match(storageSource, /CUSTOM_CLEANUP_PROMPT_KEY = "customCleanupPrompt"/);
  assert.match(storageSource, /storage\.removeItem\(LEGACY_PROMPT_SET_KEY\)/);
  assert.match(storageSource, /storage\.removeItem\(LEGACY_CUSTOM_PROMPT_KEY\)/);
  assert.match(storageSource, /storage\.removeItem\(LEGACY_NAME_KEY\)/);
  assert.match(storageSource, /storage\.removeItem\(LEGACY_VOICE_FLAG_KEY\)/);
  assert.doesNotMatch(settingsSource, /voiceAssistantEnabled: readBoolean/);
  assert.doesNotMatch(settingsSource, /setVoiceAssistantEnabled/);
  assert.doesNotMatch(settingsSource, /ensureAgentNameInDictionary/);
});

test("legacy prompt migration keeps safe cleanup prompts and removes voice mode keys", async () => {
  const { module: storageModule, cleanup } = await loadBundledModule("src/utils/promptStorage.ts");
  const legacyPromptKey = "custom" + "Unified" + "Prompt";
  const legacyPromptSetKey = "custom" + "Prompts";
  const legacyNameKey = "agent" + "Name";
  const legacyVoiceFlagKey = "voiceAssistant" + "Enabled";

  function createStorage(entries) {
    const values = new Map(Object.entries(entries));
    return {
      getItem(key) {
        return values.has(key) ? values.get(key) : null;
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
      removeItem(key) {
        values.delete(key);
      },
    };
  }

  try {
    const safeStorage = createStorage({
      [legacyPromptKey]: JSON.stringify("Clean punctuation only."),
      [legacyPromptSetKey]: JSON.stringify({ cleanup: "Legacy cleanup" }),
      [legacyNameKey]: "Mouthpiece",
      [legacyVoiceFlagKey]: "true",
    });

    storageModule.migrateLegacyVoiceModeStorage(safeStorage);
    assert.equal(
      safeStorage.getItem(storageModule.CUSTOM_CLEANUP_PROMPT_KEY),
      JSON.stringify("Clean punctuation only.")
    );
    assert.equal(safeStorage.getItem(legacyPromptKey), null);
    assert.equal(safeStorage.getItem(legacyPromptSetKey), null);
    assert.equal(safeStorage.getItem(legacyNameKey), null);
    assert.equal(safeStorage.getItem(legacyVoiceFlagKey), null);

    const unsafeStorage = createStorage({
      [legacyPromptKey]: JSON.stringify("MODE 2 direct address {{agentName}}"),
      [legacyNameKey]: "Mouthpiece",
      [legacyVoiceFlagKey]: "true",
    });

    storageModule.migrateLegacyVoiceModeStorage(unsafeStorage);
    assert.equal(unsafeStorage.getItem(storageModule.CUSTOM_CLEANUP_PROMPT_KEY), null);
    assert.equal(unsafeStorage.getItem(legacyPromptKey), null);
    assert.equal(unsafeStorage.getItem(legacyNameKey), null);
    assert.equal(unsafeStorage.getItem(legacyVoiceFlagKey), null);
  } finally {
    cleanup();
  }
});
