import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function readRepoJson(relativePath) {
  return JSON.parse(await readRepoFile(relativePath));
}

test("destructive toast keeps the close button on a dedicated clickable layer", async () => {
  const source = await readRepoFile("src/components/ui/Toast.tsx");

  assert.match(
    source,
    /absolute right-2 top-2 z-10[\s\S]*pointer-events-auto[\s\S]*focus-visible:ring-1/
  );
  assert.match(source, /const dismissToast = React\.useCallback/);
});

test("destructive toast renders error details in a scrollable card-like panel", async () => {
  const source = await readRepoFile("src/components/ui/Toast.tsx");

  assert.match(source, /overflow-y-auto[\s\S]*whitespace-pre-wrap/);
  assert.match(source, /toast-error-surface/);
  assert.match(source, /toast-error-detail/);
});

test("destructive toast uses shared compact layout tokens that fit inside the dictation window", async () => {
  const source = await readRepoFile("src/components/ui/Toast.tsx");
  const layout = await readRepoJson("src/config/errorSurfaceLayout.json");
  const { WINDOW_SIZES } = require(path.resolve(process.cwd(), "src/helpers/windowConfig.js"));

  assert.match(source, /ERROR_SURFACE_LAYOUT\.dictationToast\.widthPx/);
  assert.match(source, /ERROR_SURFACE_LAYOUT\.dictationToast\.detailMaxHeightPx/);
  assert.ok(layout.dictationToast.widthPx <= 300);
  assert.ok(
    layout.dictationToast.widthPx +
      layout.dictationToast.rightInsetPx +
      layout.dictationToast.leftSafeInsetPx <=
      WINDOW_SIZES.WITH_TOAST.width
  );
});
