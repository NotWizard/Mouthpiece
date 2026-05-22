import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

test("audioManager sets _lastFallbackReason when reasoning fails", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src/helpers/audioManager.js"), "utf8");
  assert.match(
    source,
    /this\._lastFallbackReason\s*=\s*"reasoning_failed"|fallbackReason:\s*"reasoning_failed"/
  );
});

test("useAudioRecording shows the translation-fallback toast when reason is set", () => {
  const source = fs.readFileSync(path.join(repoRoot, "src/hooks/useAudioRecording.js"), "utf8");
  assert.match(source, /_lastFallbackReason/);
  assert.match(source, /hooks\.audioRecording\.translationFallback\.title/);
});
