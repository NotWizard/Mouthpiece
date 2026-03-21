import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("text edit monitor can skip monitoring entirely when the insertion plan disables it", async () => {
  const source = await readRepoFile("src/helpers/textEditMonitor.js");

  assert.match(source, /const monitorMode = options\.monitorMode \|\| "standard";/);
  assert.match(source, /if \(monitorMode === "disabled"\)/);
});

test("text edit monitor emits insertion intent metadata with text-edited events", async () => {
  const source = await readRepoFile("src/helpers/textEditMonitor.js");

  assert.match(source, /intent:\s*this\.currentIntent \|\| "insert"/);
  assert.match(source, /monitorMode:\s*this\.currentMonitorMode \|\| "standard"/);
});
