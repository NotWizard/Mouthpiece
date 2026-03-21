import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoJson(relativePath) {
  const source = await fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");

  return JSON.parse(source);
}

test("package metadata includes an author email for Linux package generation", async () => {
  const packageJson = await readRepoJson("package.json");

  assert.equal(typeof packageJson.author?.name, "string");
  assert.equal(typeof packageJson.author?.email, "string");
  assert.match(packageJson.author.email, /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
});

test("electron-builder deb config pins an explicit maintainer", async () => {
  const [packageJson, builderConfig] = await Promise.all([
    readRepoJson("package.json"),
    readRepoJson("electron-builder.json"),
  ]);

  assert.equal(
    builderConfig.deb?.maintainer,
    `${packageJson.author.name} <${packageJson.author.email}>`,
  );
});
