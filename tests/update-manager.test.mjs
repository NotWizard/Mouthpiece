import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

class MockAutoUpdater extends EventEmitter {
  constructor() {
    super();
    this.autoDownload = false;
    this.autoInstallOnAppQuit = true;
    this.checkCount = 0;
    this.quitAndInstallCount = 0;
  }

  async checkForUpdates() {
    this.checkCount += 1;
    return { checkCount: this.checkCount };
  }

  quitAndInstall() {
    this.quitAndInstallCount += 1;
  }
}

test("supported packaged apps perform an immediate update check and schedule 12 hour polling", async () => {
  const UpdateManager = require("../src/helpers/updateManager");
  const mockAutoUpdater = new MockAutoUpdater();
  const timers = [];

  const manager = new UpdateManager({
    autoUpdater: mockAutoUpdater,
    platform: "darwin",
    isPackaged: true,
    env: {},
    setIntervalFn: (callback, intervalMs) => {
      timers.push({ callback, intervalMs });
      return { intervalMs };
    },
    clearIntervalFn: () => {},
  });

  await manager.start();

  assert.equal(mockAutoUpdater.autoDownload, true);
  assert.equal(mockAutoUpdater.autoInstallOnAppQuit, false);
  assert.equal(mockAutoUpdater.checkCount, 1);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].intervalMs, 12 * 60 * 60 * 1000);
});

test("downloaded updates become installable only after confirmation", async () => {
  const UpdateManager = require("../src/helpers/updateManager");
  const mockAutoUpdater = new MockAutoUpdater();

  const manager = new UpdateManager({
    autoUpdater: mockAutoUpdater,
    platform: "win32",
    isPackaged: true,
    env: {},
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  });

  await manager.start();
  mockAutoUpdater.emit("update-downloaded", { version: "1.2.3", releaseName: "v1.2.3" });

  assert.equal(manager.getStatus().status, "downloaded");

  const result = await manager.installUpdate();

  assert.deepEqual(result, { success: true });
  assert.equal(manager.getStatus().status, "installing");
  assert.equal(mockAutoUpdater.quitAndInstallCount, 1);
});

test("unsupported environments do not start updater polling", async () => {
  const UpdateManager = require("../src/helpers/updateManager");
  const mockAutoUpdater = new MockAutoUpdater();
  let timerScheduled = false;

  const manager = new UpdateManager({
    autoUpdater: mockAutoUpdater,
    platform: "linux",
    isPackaged: false,
    env: {},
    setIntervalFn: () => {
      timerScheduled = true;
      return 1;
    },
    clearIntervalFn: () => {},
  });

  const result = await manager.start();

  assert.equal(result, false);
  assert.equal(timerScheduled, false);
  assert.equal(mockAutoUpdater.checkCount, 0);
  assert.equal(manager.getStatus().status, "unsupported");
});

test("packaged Linux deb installs are treated as updater-supported", async () => {
  const UpdateManager = require("../src/helpers/updateManager");
  const mockAutoUpdater = new MockAutoUpdater();
  let timerScheduled = false;

  const manager = new UpdateManager({
    autoUpdater: mockAutoUpdater,
    platform: "linux",
    isPackaged: true,
    env: {},
    packageType: "deb",
    setIntervalFn: () => {
      timerScheduled = true;
      return 1;
    },
    clearIntervalFn: () => {},
  });

  const result = await manager.start();

  assert.equal(result, true);
  assert.equal(timerScheduled, true);
  assert.equal(mockAutoUpdater.checkCount, 1);
  assert.equal(manager.getStatus().supported, true);
  assert.equal(manager.getStatus().checkingEnabled, true);
});
