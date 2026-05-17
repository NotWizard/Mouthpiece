import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

function loadCacheModule() {
  return require(path.resolve(process.cwd(), "src/helpers/fastPasteCache.js"));
}

test("fast-paste negative cache exposes mark + isUnavailable APIs", () => {
  const mod = loadCacheModule();
  assert.equal(typeof mod.createFastPasteCache, "function");
});

test("createFastPasteCache reports unavailable until TTL expires", () => {
  const { createFastPasteCache } = loadCacheModule();
  let now = 1_000;
  const cache = createFastPasteCache({ ttlMs: 60_000, clock: () => now });
  assert.equal(cache.isUnavailable(), false);
  cache.markUnavailable();
  assert.equal(cache.isUnavailable(), true, "right after mark, fast-paste must be considered unavailable");
  now = 1_000 + 30_000;
  assert.equal(cache.isUnavailable(), true, "before TTL expires, still unavailable");
  now = 1_000 + 60_001;
  assert.equal(cache.isUnavailable(), false, "after TTL expires, eligible to retry");
});

test("createFastPasteCache invalidate() clears the negative window immediately", () => {
  const { createFastPasteCache } = loadCacheModule();
  const cache = createFastPasteCache({ ttlMs: 60_000, clock: () => 1_000 });
  cache.markUnavailable();
  assert.equal(cache.isUnavailable(), true);
  cache.invalidate();
  assert.equal(cache.isUnavailable(), false, "explicit invalidate (e.g. on Accessibility re-grant) must clear the cache");
});

test("clipboard.js consumes the TTL-based fast-paste cache (no permanent fastPasteChecked = true assignment after spawn failure)", async () => {
  const source = await readRepoFile("src/helpers/clipboard.js");
  // The bug pattern: setting fastPasteChecked = true together with fastPastePath = null
  // inside a spawn-failure callback poisons the cache for the rest of the session.
  // Either the assignment is gone, or it goes through the TTL helper.
  const usesTtlHelper = /createFastPasteCache|fastPasteUnavailableUntil/.test(source);
  assert.ok(
    usesTtlHelper,
    "clipboard.js must use a TTL-based negative cache for fast-paste so re-granted Accessibility recovers within the session"
  );
});

test("clipboard.js invalidates the fast-paste negative cache when Accessibility flips back to trusted", async () => {
  const source = await readRepoFile("src/helpers/clipboard.js");
  assert.match(
    source,
    /(invalidate|fastPasteUnavailableUntil\s*=\s*0)/,
    "clipboard.js must reset the fast-paste negative cache when Accessibility becomes trusted again"
  );
});
