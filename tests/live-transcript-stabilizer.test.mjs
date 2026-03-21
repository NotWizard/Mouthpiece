import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadStabilizerModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/liveTranscriptStabilizer.mjs")
  ).href;

  return import(modulePath);
}

test("live transcript stabilizer starts with the whole partial in the active rewrite region", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdef");

  assert.equal(state.frozenText, "");
  assert.equal(state.semiStableText, "");
  assert.equal(state.activeText, "abcdef");
  assert.equal(state.displayText, "abcdef");
});

test("live transcript stabilizer freezes an older prefix while leaving the tail rewriteable", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdef");
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdefghi", {
    unstableTailChars: 3,
  });

  assert.equal(state.frozenText, "abc");
  assert.equal(state.semiStableText, "def");
  assert.equal(state.activeText, "ghi");
  assert.equal(state.displayText, "abcdefghi");
});

test("live transcript stabilizer preserves the frozen prefix when the model rewrites deeper history", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdef");
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdefghi", {
    unstableTailChars: 3,
  });
  state = mod.advanceLiveTranscriptStabilizer(state, "abYZefghi", {
    unstableTailChars: 3,
  });

  assert.equal(state.frozenText, "abc");
  assert.equal(state.displayText, "abcZefghi");
  assert.equal(state.activeText, "Zefghi");
});

test("live transcript stabilizer can freeze provider-committed segments immediately", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdefghi", {
    unstableTailChars: 3,
  });
  state = mod.commitLiveTranscriptStabilizer(state, "abcdef");
  state = mod.advanceLiveTranscriptStabilizer(state, "abcXYZghi", {
    unstableTailChars: 3,
  });

  assert.equal(state.frozenText.startsWith("abcdef"), true);
  assert.equal(state.displayText.startsWith("abcdef"), true);
});

test("live transcript stabilizer extends the frozen prefix when cumulative commits keep growing", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "hello world", {
    unstableTailChars: 5,
  });
  state = mod.commitLiveTranscriptStabilizer(state, "hello");
  state = mod.commitLiveTranscriptStabilizer(state, "hello world");

  assert.equal(state.frozenText, "hello world");
  assert.equal(state.displayText, "hello world");
});

test("live transcript stabilizer preserves committed whitespace boundaries", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "hello world ", {
    unstableTailChars: 6,
  });
  state = mod.commitLiveTranscriptStabilizer(state, "hello ");

  assert.equal(state.frozenText, "hello ");
  assert.equal(state.displayText.startsWith("hello "), true);
});

test("live transcript stabilizer resets cleanly when the partial disappears", async () => {
  const mod = await loadStabilizerModule();

  let state = mod.createLiveTranscriptStabilizerState();
  state = mod.advanceLiveTranscriptStabilizer(state, "abcdef");
  state = mod.advanceLiveTranscriptStabilizer(state, "");

  assert.deepEqual(state, mod.createLiveTranscriptStabilizerState());
});
