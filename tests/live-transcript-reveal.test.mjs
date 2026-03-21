import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadRevealModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/liveTranscriptReveal.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("live transcript reveal appends new characters in small ordered steps", async () => {
  const mod = await loadRevealModule();

  assert.equal(typeof mod.stepLiveTranscriptReveal, "function");

  const next = mod.stepLiveTranscriptReveal({
    renderedText: "现在这个",
    targetText: "现在这个效果里面",
    maxCharsPerStep: 1,
  });

  assert.equal(next, "现在这个效");
});

test("live transcript reveal preserves the shared prefix when the partial transcript is corrected", async () => {
  const mod = await loadRevealModule();

  assert.equal(typeof mod.getLiveTranscriptRevealBase, "function");
  assert.equal(typeof mod.stepLiveTranscriptReveal, "function");

  const base = mod.getLiveTranscriptRevealBase({
    renderedText: "它到底有没有正确的",
    targetText: "它到底有没有被正确地",
  });
  const next = mod.stepLiveTranscriptReveal({
    renderedText: "它到底有没有正确的",
    targetText: "它到底有没有被正确地",
    maxCharsPerStep: 2,
  });

  assert.equal(base, "它到底有没有");
  assert.equal(next, "它到底有没有被正");
});

test("live transcript reveal clears immediately when the target text disappears", async () => {
  const mod = await loadRevealModule();

  assert.equal(typeof mod.stepLiveTranscriptReveal, "function");

  const next = mod.stepLiveTranscriptReveal({
    renderedText: "现在这个对应的效果里面",
    targetText: "",
    maxCharsPerStep: 2,
  });

  assert.equal(next, "");
});

test("live transcript reveal snaps forward when a capped preview window slides to newer text", async () => {
  const mod = await loadRevealModule();

  assert.equal(typeof mod.getLiveTranscriptRevealBase, "function");
  assert.equal(typeof mod.stepLiveTranscriptReveal, "function");

  const base = mod.getLiveTranscriptRevealBase({
    renderedText: "abcdefghij",
    targetText: "bcdefghijk",
  });
  const next = mod.stepLiveTranscriptReveal({
    renderedText: "abcdefghij",
    targetText: "bcdefghijk",
    maxCharsPerStep: 1,
  });

  assert.equal(base, "bcdefghijk");
  assert.equal(next, "bcdefghijk");
});
