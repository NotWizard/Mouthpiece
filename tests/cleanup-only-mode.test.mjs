import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("prompt resolution no longer switches into assistant mode", async () => {
  const source = await readRepoFile("src/config/prompts.ts");

  assert.doesNotMatch(source, /voiceAssistantEnabled/);
  assert.doesNotMatch(source, /reasoningEnableAgentMode/);
  assert.doesNotMatch(source, /useFullPrompt/);
  assert.doesNotMatch(source, /detectAgentName/);
});

test("audio cleanup pipeline no longer branches on voice assistant mode", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.doesNotMatch(source, /AGENT_WAKE_PHRASE_DETECTED/);
  assert.doesNotMatch(source, /voiceAssistantEnabled/);
});

test("settings page no longer renders agent configuration controls", async () => {
  const source = await readRepoFile("src/components/SettingsPage.tsx");

  assert.doesNotMatch(source, /case "agentConfig"/);
  assert.doesNotMatch(source, /settingsPage\.agentConfig\./);
  assert.doesNotMatch(source, /voiceAssistantToggle/);
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
