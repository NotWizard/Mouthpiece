import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const JS_IMPORT_TS_PATTERN =
  /(?:require\(\s*["'][^"']+\.ts["']\s*\)|from\s+["'][^"']+\.ts["'])/g;

async function collectJsFiles(rootDir) {
  const results = [];
  const entries = await fs.readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      results.push(...(await collectJsFiles(absolutePath)));
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith(".js")) {
      results.push(absolutePath);
    }
  }

  return results;
}

function isCommonJsRuntimeFile(source) {
  return /\brequire\(/.test(source) || /\bmodule\.exports\b/.test(source);
}

test("CommonJS runtime JavaScript files do not directly import TypeScript modules", async () => {
  const srcDir = path.resolve(process.cwd(), "src");
  const jsFiles = await collectJsFiles(srcDir);
  const offenders = [];

  for (const filePath of jsFiles) {
    const source = await fs.readFile(filePath, "utf8");
    if (!isCommonJsRuntimeFile(source)) {
      continue;
    }

    const matches = source.match(JS_IMPORT_TS_PATTERN);

    if (matches?.length) {
      offenders.push({
        filePath: path.relative(process.cwd(), filePath),
        matches,
      });
    }
  }

  assert.deepEqual(offenders, []);
});
