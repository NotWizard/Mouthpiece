import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("useAudioRecording stabilizes partial transcript text before sending it to the live preview", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(source, /advanceLiveTranscriptStabilizer/);
  assert.match(source, /commitLiveTranscriptStabilizer/);
  assert.match(source, /createLiveTranscriptStabilizerState/);
  assert.match(source, /const partialStabilizerRef = useRef\(createLiveTranscriptStabilizerState\(\)\);/);
  assert.match(source, /const nextPartialState = advanceLiveTranscriptStabilizer\(/);
  assert.match(source, /setPartialTranscript\(nextPartialState\.displayText\);/);
  assert.match(source, /onStreamingCommit: \(committedText\) => \{/);
  assert.match(source, /partialStabilizerRef\.current = commitLiveTranscriptStabilizer\(/);
});

test("useAudioRecording exposes structured live transcript segments so the capsule can distinguish the stable prefix from the active tail", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(source, /function buildLiveTranscriptSegments/);
  assert.match(source, /const \[partialTranscriptSegments, setPartialTranscriptSegments\] = useState\(/);
  assert.match(source, /setPartialTranscriptSegments\(buildLiveTranscriptSegments\(nextPartialState\)\);/);
  assert.match(
    source,
    /setPartialTranscriptSegments\(buildLiveTranscriptSegments\(partialStabilizerRef\.current\)\);/
  );
  assert.match(source, /partialTranscriptSegments,/);
});

test("useAudioRecording can accept provider-native live transcript segments without running them back through the generic stabilizer", async () => {
  const hookSource = await readRepoFile("src/hooks/useAudioRecording.js");
  const managerSource = await readRepoFile("src/helpers/audioManager.js");

  assert.match(hookSource, /function normalizeProviderLiveTranscriptSegments\(text\)/);
  assert.match(hookSource, /typeof text\.fullText === "string"/);
  assert.match(hookSource, /setPartialTranscriptSegments\(\{\s*stableText:\s*text\.stableText \|\| ""/s);
  assert.match(managerSource, /const isStructuredBailianPayload =[\s\S]*streamingProviderName === "bailian"[\s\S]*typeof partialPayload === "object"/);
});

test("audio manager resolves the streaming provider name before wiring the partial transcript callback", async () => {
  const managerSource = await readRepoFile("src/helpers/audioManager.js");

  assert.match(
    managerSource,
    /const provider = this\.getStreamingProvider\(\);\s+const streamingProviderName = this\.getStreamingProviderName\(\);[\s\S]*const partialCleanup = provider\.onPartial\(/s
  );
});

test("stabilized partials can promote the dictation session into the partial-stable state", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(
    source,
    /if \(nextPartialState\.frozenText\) \{\s*trackSessionEvent\("first_stable_partial"/s
  );
});

test("audio manager forwards cumulative committed transcript text instead of only the latest delta", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /this\.onStreamingCommit\?\.\(text\);/);
  assert.equal(/this\.onStreamingCommit\?\.\(newSegment\);/.test(source), false);
});

test("Phase 2 and Phase 3 wiring still respects the rollout flags", async () => {
  const hookSource = await readRepoFile("src/hooks/useAudioRecording.js");
  const managerSource = await readRepoFile("src/helpers/audioManager.js");

  assert.match(hookSource, /featureFlagsRef\.current\.incrementalStabilizer/);
  assert.match(managerSource, /this\.asrFeatureFlags\.multiStateVad/);
});
