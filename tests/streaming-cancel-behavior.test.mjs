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
    /const didCancel =[\s\S]*state\.isStreaming \|\| state\.isStreamingStartInProgress[\s\S]*await audioManagerRef\.current\.cancelStreamingRecording\(\)[\s\S]*return didCancel;/s
  );
});

test("useAudioRecording ignores duplicate starts while realtime startup is in progress", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/hooks/useAudioRecording.js"),
    "utf8"
  );

  assert.match(
    source,
    /if \(\s*currentState\.isRecording \|\|\s*currentState\.isProcessing \|\|\s*currentState\.isStreaming \|\|\s*currentState\.isStreamingStartInProgress\s*\)\s*\{\s*return false;\s*\}/s
  );
});

test("streaming provider duplicate starts return a structured retryable code", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/ipcHandlers.js"),
    "utf8"
  );

  for (const guardName of [
    "streamingStartInProgress",
    "sonioxStreamingStartInProgress",
    "bailianRealtimeStartInProgress",
    "deepgramStreamingStartInProgress",
  ]) {
    assert.match(
      source,
      new RegExp(
        `if \\(${guardName}\\) \\{[\\s\\S]*return \\{ success: false, error: "Operation in progress", code: "START_IN_PROGRESS" \\};[\\s\\S]*\\}`,
        "s"
      )
    );
  }
});

test("audio manager treats duplicate streaming startup as a benign in-flight request", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/audioManager.js"),
    "utf8"
  );

  assert.match(source, /error\.code === "START_IN_PROGRESS"/);
  assert.match(
    source,
    /logger\.warn\("Duplicate streaming start ignored"[\s\S]*await this\.cleanupStreaming\(\);[\s\S]*return false;/s
  );
});

test("audio manager does not show a destructive streaming error for duplicate startup", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/audioManager.js"),
    "utf8"
  );

  const duplicateStartBranch = source.match(
    /if \(error\.code === "START_IN_PROGRESS"\) \{[\s\S]*?return false;\s*\}/
  )?.[0];

  assert.ok(duplicateStartBranch);
  assert.doesNotMatch(duplicateStartBranch, /this\.onError\?\.\(/);
});
