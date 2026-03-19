import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("dictation overlay passes an explicit live-preview flag into the capsule", () => {
  const source = read("src/App.jsx");

  assert.match(
    source,
    /const showTranscriptPreview = Boolean\(liveTranscriptLabel\) && isRecording;/
  );
  assert.match(source, /<DictationCapsule[\s\S]*showTranscriptPreview=\{showTranscriptPreview\}/);
});

test("dictation capsule keeps the recording shell stable even before the first live transcript arrives", () => {
  const source = read("src/components/DictationCapsule.tsx");

  assert.match(source, /const liveShellActive = isRecording;/);
  assert.match(
    source,
    /const layout = liveShellActive \? previewLayout : getDictationCapsuleLayout\(\{ stage: visualState\.stage \}\);/
  );
  assert.match(source, /\{liveShellActive && \(/);
});

test("dictation overlay falls back to processing copy as soon as recording stops", () => {
  const source = read("src/App.jsx");

  assert.match(
    source,
    /const secondaryLabel =\s*liveTranscriptLabel && isRecording\s*\?\s*liveTranscriptLabel\s*:\s*isRecording\s*\?\s*t\("app\.mic\.recording"\)\s*:\s*isProcessing\s*\?\s*t\("app\.mic\.processing"\)\s*:\s*isTranscribing\s*\?\s*t\("app\.mic\.transcribing"\)\s*:\s*t\("app\.mic\.processing"\);/s
  );
});

test("dictation capsule renders live transcript motion on a single measured text rail instead of flashing between two text layers", () => {
  const source = read("src/components/DictationCapsule.tsx");

  assert.match(source, /showTranscriptPreview: boolean;/);
  assert.match(source, /normalizeLiveTranscriptText/);
  assert.match(source, /getLiveTranscriptOffsetPx/);
  assert.match(source, /useLayoutEffect/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /const previewLayout = getDictationCapsuleLayout\(\{ stage: "preview" \}\);/);
  assert.match(source, /translate3d\(\$\{livePreviewOffsetPx\}px, 0, 0\)/);
  assert.match(source, /WebkitMaskImage/);
  assert.match(source, /whitespace-nowrap/);
  assert.match(source, /text-\[13px\]/);
  assert.match(source, /mt-auto flex h-3 items-center justify-between/);
  assert.doesNotMatch(source, /outgoingPreviewText/);
  assert.doesNotMatch(source, /isPreviewTransitionActive/);
});

test("dictation capsule stages the first live transcript with a listening ghost exit and transcript reveal instead of a hard text swap", () => {
  const source = read("src/components/DictationCapsule.tsx");

  assert.match(source, /const \[showListeningGhost, setShowListeningGhost\] = useState\(false\);/);
  assert.match(
    source,
    /const \[isTranscriptEntranceActive, setIsTranscriptEntranceActive\] = useState\(false\);/
  );
  assert.match(source, /const listeningGhostText = helperText;/);
  assert.match(source, /if \(showTranscriptPreview && !wasShowingTranscriptPreview\) \{/);
  assert.match(source, /window\.requestAnimationFrame\(\(\) => \{\s*setIsTranscriptEntranceActive\(true\);/s);
  assert.match(source, /transition-\[transform,opacity,clip-path,filter\]/);
  assert.match(source, /clipPath:/);
  assert.match(source, /showListeningGhost && \(/);
  assert.match(source, /transition-\[opacity,transform,filter\]/);
});
