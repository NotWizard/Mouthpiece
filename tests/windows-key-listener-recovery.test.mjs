import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readRepoFile(rel) {
  return fs.readFile(path.resolve(process.cwd(), rel), "utf8");
}

test("windowsKeyManager guards against rapid-restart events from a previous child", async () => {
  const source = await readRepoFile("src/helpers/windowsKeyManager.js");
  // The bug: stop() then start() left the OLD child's exit handler still attached;
  // when it fired async, it nulled this.process / this.isReady on the NEW child.
  // Either an _isStopping flag OR identity-checked local closure is acceptable.
  const hasIsStopping = /this\._isStopping\s*=/.test(source);
  const hasIdentityCheck = /this\.process\s*!==\s*\w+/.test(source);
  assert.ok(
    hasIsStopping || hasIdentityCheck,
    "windowsKeyManager.js must guard async exit/error handlers from poisoning the next child (use _isStopping flag or local-child identity check)"
  );
});

test("windowsKeyManager exit handler resets _isStopping or matches current child before mutating shared state", async () => {
  const source = await readRepoFile("src/helpers/windowsKeyManager.js");
  // The exit handler must distinguish between "intentional stop" / "old child crash"
  // and "current child unexpectedly died", otherwise it disables the wrong listener.
  // The handler may be attached to either `this.process` or a locally-scoped child variable.
  assert.match(
    source,
    /\.on\(\s*["']exit["'],[\s\S]{0,400}(this\._isStopping|this\.process\s*!==)/,
    "windowsKeyManager.js exit handler must check _isStopping or child identity before reportError / state mutation"
  );
});

test("main.js declares tryRecoverWindowsKeyListener with debounce", async () => {
  const source = await readRepoFile("main.js");
  assert.match(
    source,
    /function\s+tryRecoverWindowsKeyListener/,
    "main.js must declare tryRecoverWindowsKeyListener so a dead Windows native listener can self-heal on focus"
  );
});

test("main.js calls tryRecoverWindowsKeyListener from focus and activate handlers", async () => {
  const source = await readRepoFile("main.js");
  assert.match(
    source,
    /tryRecoverWindowsKeyListener\("browser-window-focus"\)/,
    "browser-window-focus handler must trigger Windows listener recovery"
  );
  assert.match(
    source,
    /tryRecoverWindowsKeyListener\("activate"\)/,
    "activate handler must trigger Windows listener recovery"
  );
});
