import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

test("package scripts expose replay verification commands for ASR release gates", async () => {
  const source = await readRepoFile("package.json");

  assert.match(source, /"replay:asr": "node scripts\/run-asr-replay\.mjs"/);
  assert.match(
    source,
    /"verify:asr-benchmarks": "node scripts\/verify-asr-benchmarks\.mjs --input tmp\/asr-replay\.json"/
  );
});

test("release workflow runs replay generation and benchmark verification before packaging", async () => {
  const source = await readRepoFile(".github/workflows/release.yml");

  assert.match(source, /npm run replay:asr -- --output tmp\/asr-replay\.json/);
  assert.match(source, /npm run verify:asr-benchmarks/);
});

test("ASR release checklist documents replay, insertion, privacy, and rollback gates", async () => {
  const source = await readRepoFile("docs/release/asr-quality-checklist.md");

  assert.match(source, /Replay benchmark summary/i);
  assert.match(source, /Insertion smoke matrix/i);
  assert.match(source, /Sensitive app review/i);
  assert.match(source, /Rollback criteria/i);
});
