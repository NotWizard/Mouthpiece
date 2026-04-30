import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

function loadLocalCodesignModule() {
  try {
    return require(path.resolve(process.cwd(), "scripts/sign-macos-local.js"));
  } catch {
    return {};
  }
}

test("local macOS codesign script builds nested helper commands before signing the app bundle", () => {
  const mod = loadLocalCodesignModule();

  assert.equal(mod.DEFAULT_IDENTITY, "Mouthpiece Local Codesign");
  assert.equal(typeof mod.buildCodesignPlan, "function");

  const plan = mod.buildCodesignPlan({
    appPath: "/tmp/Mouthpiece.app",
    identity: "Mouthpiece Local Codesign",
    entitlementsPath: "/repo/resources/mac/entitlements.mac.plist",
    existingPaths: new Set([
      "/tmp/Mouthpiece.app/Contents/MacOS/Mouthpiece",
      "/tmp/Mouthpiece.app/Contents/Frameworks/Electron Framework.framework",
      "/tmp/Mouthpiece.app/Contents/Frameworks/Mouthpiece Helper.app",
      "/tmp/Mouthpiece.app/Contents/Resources/bin/macos-permission-flow",
      "/tmp/Mouthpiece.app/Contents/Resources/bin/macos-fast-paste",
    ]),
  });

  assert.ok(plan.length >= 2);
  assert.equal(plan.at(-1).target, "/tmp/Mouthpiece.app");
  assert.deepEqual(plan.at(-1).args.slice(0, 6), [
    "--force",
    "--sign",
    "Mouthpiece Local Codesign",
    "--timestamp=none",
    "--options",
    "runtime",
  ]);
  assert.ok(plan.at(-1).args.includes("--entitlements"));

  const targetOrder = plan.map((entry) => entry.target);
  assert.ok(
    targetOrder.indexOf("/tmp/Mouthpiece.app/Contents/Resources/bin/macos-permission-flow") <
      targetOrder.indexOf("/tmp/Mouthpiece.app")
  );
  assert.ok(
    targetOrder.indexOf("/tmp/Mouthpiece.app/Contents/Frameworks/Electron Framework.framework") <
      targetOrder.indexOf("/tmp/Mouthpiece.app")
  );
  assert.ok(
    targetOrder.indexOf("/tmp/Mouthpiece.app/Contents/Frameworks/Mouthpiece Helper.app") <
      targetOrder.indexOf("/tmp/Mouthpiece.app")
  );
  assert.ok(
    plan
      .find((entry) => entry.target === "/tmp/Mouthpiece.app/Contents/Frameworks/Mouthpiece Helper.app")
      ?.args.includes("--entitlements")
  );
});

test("package exposes a local macOS pack script and documentation explains self-signed limitations", async () => {
  const [packageSource, docsSource] = await Promise.all([
    readRepoFile("package.json"),
    readRepoFile("docs/macos-local-codesign.md"),
  ]);

  assert.match(packageSource, /"pack:mac:local":/);
  assert.match(packageSource, /sign-macos-local/);
  assert.match(docsSource, /Mouthpiece Local Codesign/);
  assert.match(docsSource, /Developer ID/);
  assert.match(docsSource, /notarization/);
  assert.match(docsSource, /com\.mouthpiece\.app/);
});
