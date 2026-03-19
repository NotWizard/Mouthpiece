import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("dialog primitives expose premium shell variants for destructive flows", async () => {
  const source = await readRepoFile("src/components/ui/dialog.tsx");

  assert.match(source, /dialog-premium-shell/);
  assert.match(source, /dialog-premium-shell-destructive/);
  assert.match(source, /type DialogTone = "default" \| "destructive"/);
});

test("alert destructive variant uses premium shared surfaces instead of legacy red blocks", async () => {
  const source = await readRepoFile("src/components/ui/alert.tsx");

  assert.match(source, /alert-premium/);
  assert.match(source, /alert-premium-destructive/);
  assert.doesNotMatch(source, /bg-red-50|border-red-200|text-red-900/);
});

test("shared inline error notice replaces bespoke destructive banners in core flows", async () => {
  const noticeSource = await readRepoFile("src/components/ui/ErrorNotice.tsx");

  assert.match(noticeSource, /inline-error-notice/);
  assert.match(noticeSource, /<Alert variant="destructive"/);

  for (const relativePath of [
    "src/components/AuthenticationStep.tsx",
    "src/components/EmailVerificationStep.tsx",
    "src/components/ForgotPasswordView.tsx",
    "src/components/ResetPasswordView.tsx",
    "src/components/ui/MicrophoneSettings.tsx",
    "src/components/ReasoningModelSelector.tsx",
  ]) {
    const source = await readRepoFile(relativePath);
    assert.match(source, /ErrorNotice/);
    assert.doesNotMatch(source, /bg-destructive\/5|border border-destructive\/20/);
  }
});
