import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("runtime config exposes an explicit Mouthpiece Cloud availability flag", async () => {
  const source = await readRepoFile("src/config/runtimeConfig.ts");

  assert.match(source, /enableMouthpieceCloud/);
});

test("settings defaults no longer point transcription mode at deprecated openwhispr cloud", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  assert.doesNotMatch(
    source,
    /cloudTranscriptionMode:\s*readString\(\s*"cloudTranscriptionMode",\s*hasStoredByokKey\(\)\s*\|\|\s*!CLOUD_AUTH_AVAILABLE\s*\?\s*"byok"\s*:\s*"openwhispr"/
  );
});

test("settings defaults no longer point reasoning mode at deprecated openwhispr cloud", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  assert.doesNotMatch(
    source,
    /cloudReasoningMode:\s*readString\(\s*"cloudReasoningMode",\s*CLOUD_AUTH_AVAILABLE\s*\?\s*"openwhispr"\s*:\s*"byok"\s*\)/
  );
});

test("cloud reasoning selector is no longer driven by auth state alone", async () => {
  const source = await readRepoFile("src/stores/settingsStore.ts");

  assert.doesNotMatch(
    source,
    /export const selectIsCloudReasoningMode = \(state: SettingsState\) =>\s*CLOUD_AUTH_AVAILABLE && state\.isSignedIn && state\.cloudReasoningMode === "openwhispr"/
  );
});

test("control panel no longer migrates signed-in users back to deprecated openwhispr cloud", async () => {
  const source = await readRepoFile("src/components/ControlPanel.tsx");

  assert.doesNotMatch(source, /pendingCloudMigration/);
  assert.doesNotMatch(source, /setCloudTranscriptionMode\("openwhispr"\)/);
});

test("onboarding no longer hardcodes or configures a custom agent name", async () => {
  const source = await readRepoFile("src/components/OnboardingFlow.tsx");

  assert.doesNotMatch(source, /const agentName = "Mouthpiece"/);
  assert.doesNotMatch(source, /getAgentName|saveAgentName|setVoiceAssistantEnabled/);
});

test("only one llamaCppInstaller implementation remains in src/helpers", async () => {
  const helperDir = path.resolve(process.cwd(), "src/helpers");
  const entries = await fs.readdir(helperDir);

  assert.ok(entries.includes("llamaCppInstaller.js"));
  assert.ok(!entries.includes("llamaCppInstaller.ts"));
});

test("product identity constants are centralized instead of duplicated in both app entry points", async () => {
  const [mainProcessSource, rendererSource] = await Promise.all([
    readRepoFile("main.js"),
    readRepoFile("src/main.jsx"),
  ]);

  assert.doesNotMatch(mainProcessSource, /const DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL = \{/);
  assert.match(mainProcessSource, /productIdentity/);

  assert.doesNotMatch(rendererSource, /const DEFAULT_OAUTH_PROTOCOL_BY_CHANNEL = \{/);
  assert.match(rendererSource, /productIdentity/);
});

test("supported UI locales come from a shared manifest instead of duplicated lists", async () => {
  const [i18nSource, i18nMainSource, settingsSource] = await Promise.all([
    readRepoFile("src/i18n.ts"),
    readRepoFile("src/helpers/i18nMain.js"),
    readRepoFile("src/components/SettingsPage.tsx"),
  ]);

  const localeManifestPath = path.resolve(process.cwd(), "src/locales/localeManifest.js");
  const localeManifest = await fs.readFile(localeManifestPath, "utf8");

  assert.match(localeManifest, /SUPPORTED_UI_LANGUAGES/);
  assert.match(localeManifest, /UI_LANGUAGE_OPTIONS/);

  assert.doesNotMatch(i18nSource, /export const SUPPORTED_UI_LANGUAGES = \[/);
  assert.match(i18nSource, /localeManifest/);

  assert.doesNotMatch(i18nMainSource, /const SUPPORTED_UI_LANGUAGES = \[/);
  assert.match(i18nMainSource, /localeManifest/);

  assert.doesNotMatch(settingsSource, /const UI_LANGUAGE_OPTIONS: /);
  assert.match(settingsSource, /localeManifest/);
});

test("AGENTS and CLAUDE docs describe current onboarding and omit legacy agent naming", async () => {
  const [agentsDoc, claudeDoc] = await Promise.all([
    readRepoFile("AGENTS.md"),
    readRepoFile("CLAUDE.md"),
  ]);

  for (const source of [agentsDoc, claudeDoc]) {
    assert.doesNotMatch(source, /8-step first-time setup wizard/);
    assert.doesNotMatch(source, /processed_text TEXT/);
    assert.doesNotMatch(source, /processing_method TEXT DEFAULT 'none'/);
    assert.doesNotMatch(source, /agent_name TEXT/);
    assert.doesNotMatch(source, /User names their agent during onboarding \(step 6\/8\)/);
    assert.doesNotMatch(source, /Agent name defaults to `Mouthpiece` and can be changed later in Settings\./);

    assert.match(source, /\*\*OnboardingFlow\.tsx\*\*: 3-step first-time setup wizard/);
    assert.match(source, /CREATE TABLE transcriptions \(\s*id INTEGER PRIMARY KEY AUTOINCREMENT,\s*text TEXT NOT NULL,/s);
    assert.match(source, /CREATE TABLE IF NOT EXISTS custom_dictionary|CREATE TABLE custom_dictionary/);
  }
});
