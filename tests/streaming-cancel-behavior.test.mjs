import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("audio manager exposes a dedicated streaming cancel path that skips final delivery", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/audioManager.js"),
    "utf8"
  );

  assert.match(source, /async cancelStreamingRecording\(\) \{/);
  assert.match(source, /this\.stopRequestedDuringStreamingStart = false;/);
  assert.match(source, /await provider\.stop\(\s*false\s*\)/);
  assert.match(
    source,
    /this\.isRecording = false;[\s\S]*this\.isProcessing = false;[\s\S]*this\.onStateChange\?\.\(\{ isRecording: false, isProcessing: false, isStreaming: false \}\);/s
  );
  assert.doesNotMatch(
    source,
    /async cancelStreamingRecording\(\) \{[\s\S]*this\.onTranscriptionComplete\?\.\(/s
  );
});

test("streaming stop marks processing active before post-stream guards decide whether to continue", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/audioManager.js"),
    "utf8"
  );

  assert.match(
    source,
    /this\.isProcessing = true;\s*this\.onStateChange\?\.\(\{ isRecording: false, isProcessing: true, isStreaming: false \}\);/s
  );
});

test("useAudioRecording routes realtime overlay cancellation to the dedicated streaming cancel path", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/hooks/useAudioRecording.js"),
    "utf8"
  );

  assert.match(
    source,
    /if \(state\.isStreaming \|\| state\.isStreamingStartInProgress\) \{\s*return await audioManagerRef\.current\.cancelStreamingRecording\(\);\s*\}/s
  );
});
