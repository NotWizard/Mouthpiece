import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("debug logs older than 7 days are pruned", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/helpers/debugLogger.js"),
    "utf8"
  );

  assert.match(source, /const LOG_MAX_AGE_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
  assert.doesNotMatch(source, /LOG_MAX_AGE_MS = 14 \*/);
});
