import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("destructive toast keeps the close button on a dedicated clickable layer", async () => {
  const source = await readRepoFile("src/components/ui/Toast.tsx");

  assert.match(
    source,
    /absolute right-2 top-2 z-10[\s\S]*pointer-events-auto[\s\S]*focus-visible:ring-1/
  );
});

test("destructive toast renders error details in a scrollable card-like panel", async () => {
  const source = await readRepoFile("src/components/ui/Toast.tsx");

  assert.match(source, /max-h-\[220px\][\s\S]*overflow-y-auto[\s\S]*whitespace-pre-wrap/);
  assert.match(source, /rounded-\[10px\][\s\S]*border border-red-400\/14[\s\S]*bg-red-500\/\[0\.06\]/);
});
