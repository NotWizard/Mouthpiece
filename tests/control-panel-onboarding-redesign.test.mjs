import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("control panel redesign defines a shared macOS-style visual token system", async () => {
  const css = await readRepoFile("src/index.css");

  assert.match(css, /--mp-control-window-bg:/);
  assert.match(css, /--mp-control-sidebar-bg:/);
  assert.match(css, /--mp-control-panel-bg:/);
  assert.match(css, /--mp-control-selected-bg:/);
  assert.match(css, /\.control-panel-shell/);
  assert.match(css, /\.onboarding-shell/);
});

test("control panel uses the shared shell, sidebar, and content wrappers", async () => {
  const [controlPanelSource, sidebarSource] = await Promise.all([
    readRepoFile("src/components/ControlPanel.tsx"),
    readRepoFile("src/components/ControlPanelSidebar.tsx"),
  ]);

  assert.match(controlPanelSource, /control-panel-shell/);
  assert.match(controlPanelSource, /control-panel-content-scroll/);
  assert.match(controlPanelSource, /const SIDEBAR_VIEW_CONTENT_CLASS_NAME = "control-panel-view-content";/);
  assert.match(sidebarSource, /control-panel-sidebar/);
  assert.match(sidebarSource, /control-panel-sidebar-item-active/);
});

test("settings page uses grouped list styling instead of card-heavy settings panels", async () => {
  const settingsSource = await readRepoFile("src/components/SettingsPage.tsx");

  assert.match(settingsSource, /settings-group/);
  assert.match(settingsSource, /settings-group-row/);
  assert.match(settingsSource, /settings-section-header/);
  assert.doesNotMatch(settingsSource, /bg-card\/50 dark:bg-surface-2\/50 backdrop-blur-sm divide-y/);
});

test("onboarding uses the shared wizard shell without wrapping every step in a heavy card", async () => {
  const onboardingSource = await readRepoFile("src/components/OnboardingFlow.tsx");

  assert.match(onboardingSource, /onboarding-shell/);
  assert.match(onboardingSource, /wizard-layout/);
  assert.match(onboardingSource, /wizard-panel/);
  assert.doesNotMatch(onboardingSource, /<Card className=/);
  assert.doesNotMatch(onboardingSource, /shadow-lg rounded-xl/);
});

test("onboarding progress and permission cards use subdued rail/list treatments", async () => {
  const [stepProgressSource, permissionCardSource] = await Promise.all([
    readRepoFile("src/components/ui/StepProgress.tsx"),
    readRepoFile("src/components/ui/PermissionCard.tsx"),
  ]);

  assert.match(stepProgressSource, /wizard-step-rail/);
  assert.match(stepProgressSource, /wizard-step-pill/);
  assert.doesNotMatch(stepProgressSource, /bg-success\/15/);
  assert.match(permissionCardSource, /permission-card/);
  assert.match(permissionCardSource, /permission-card-granted/);
});
