import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("App queues auto-learn correction toasts until dictation is idle", async () => {
  const source = await readRepoFile("src/App.jsx");

  assert.match(source, /const pendingLearnedCorrectionsRef = useRef\(\[\]\);/);
  assert.match(source, /const isDictationBusy = isRecording \|\| isProcessing \|\| isTranscribing;/);
  assert.match(
    source,
    /if \(isDictationBusyRef\.current\) \{\s*pendingLearnedCorrectionsRef\.current\.push\(learnedTerms\);\s*return;\s*\}/s
  );
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*if \(isDictationBusy \|\| pendingLearnedCorrectionsRef\.current\.length === 0\) \{\s*return;\s*\}[\s\S]*showLearnedCorrectionsToast\(/s
  );
  assert.match(source, /showDictationOverlayToast\(\{/);
});

test("dictation overlay interactivity effect re-runs across active dictation stage changes", async () => {
  const source = await readRepoFile("src/App.jsx");

  assert.match(
    source,
    /}, \[\s*isCommandMenuOpen,\s*isHovered,\s*isProcessing,\s*isRecording,\s*isTranscribing,\s*setWindowInteractivity,\s*shouldCaptureWindowInput,\s*toastCount,\s*\]\);/s
  );
});

test("ToastProvider dismiss resolves toast ids from a ref-backed snapshot", async () => {
  const source = await readRepoFile("src/components/ui/Toast.tsx");

  assert.match(source, /const toastsRef = React\.useRef<ToastState\[\]>\(\[\]\);/);
  assert.match(source, /React\.useEffect\(\(\) => \{\s*toastsRef\.current = toasts;\s*\}, \[toasts\]\);/s);
  assert.match(source, /const currentToasts = toastsRef\.current;/);
  assert.match(source, /const dismiss = React\.useCallback\(/);
  assert.doesNotMatch(source, /},\s*\[toasts,\s*dismissToast\]\s*\)/);
});
