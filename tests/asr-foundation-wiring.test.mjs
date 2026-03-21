import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("useAudioRecording wires session timeline tracking and exposes a formal dictation state", async () => {
  const source = await readRepoFile("src/hooks/useAudioRecording.js");

  assert.match(source, /createAsrSessionTimeline/);
  assert.match(source, /markAsrSessionEvent/);
  assert.match(source, /finalizeAsrSessionTimeline/);
  assert.match(source, /getDictationSessionState/);
  assert.match(source, /const \[sessionSummary, setSessionSummary\] = useState\(null\);/);
  assert.match(source, /const dictationState = getDictationSessionState\(\{/);
  assert.match(source, /dictationState,/);
});

test("audio manager exposes active session metadata so session IDs propagate across the dictation pipeline", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /this\.activeSession = null;/);
  assert.match(source, /beginSession\(session\)/);
  assert.match(source, /clearActiveSession\(\)/);
  assert.match(source, /sessionId:\s*this\.activeSession\?\.sessionId/);
});

test("App consumes the formal dictation state instead of only scattered booleans", async () => {
  const source = await readRepoFile("src/App.jsx");

  assert.match(source, /dictationState,/);
  assert.match(source, /shouldShowDictationCapsule\(\{\s*dictationState,/s);
  assert.match(source, /shouldKeepDictationWindowVisible\(\{\s*dictationState,/s);
  assert.match(source, /shouldCaptureDictationWindowInput\(\{\s*dictationState,/s);
});

test("package scripts expose the headless ASR replay runner for roadmap-driven regression work", async () => {
  const source = await readRepoFile("package.json");

  assert.match(source, /"replay:asr": "node scripts\/run-asr-replay\.mjs"/);
});
