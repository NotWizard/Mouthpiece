#!/usr/bin/env node

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

if (process.platform !== "darwin") {
  process.exit(0);
}

const archIndex = process.argv.indexOf("--arch");
const targetArch =
  (archIndex !== -1 && process.argv[archIndex + 1]) || process.env.TARGET_ARCH || process.arch;

const ARCH_TO_TARGET = {
  arm64: "arm64-apple-macosx11.0",
  x64: "x86_64-apple-macosx10.15",
};
const swiftTarget = ARCH_TO_TARGET[targetArch];
if (!swiftTarget) {
  console.error(`[permission-flow] Unsupported architecture: ${targetArch}`);
  process.exit(1);
}

const projectRoot = path.resolve(__dirname, "..");
const swiftSource = path.join(projectRoot, "resources", "macos-permission-flow.swift");
const outputDir = path.join(projectRoot, "resources", "bin");
const outputBinary = path.join(outputDir, "macos-permission-flow");
const hashFile = path.join(outputDir, `.macos-permission-flow.${targetArch}.hash`);
const moduleCacheDir = path.join(outputDir, ".swift-module-cache");

const ARCH_CPU_TYPE = {
  arm64: 0x0100000c,
  x64: 0x01000007,
};

function log(message) {
  console.log(`[permission-flow] ${message}`);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function verifyBinaryArch(binaryPath, expectedArch) {
  try {
    const fd = fs.openSync(binaryPath, "r");
    const header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
    const magic = header.readUInt32LE(0);
    if (magic !== 0xfeedfacf) return false;
    return header.readInt32LE(4) === ARCH_CPU_TYPE[expectedArch];
  } catch {
    return false;
  }
}

if (!fs.existsSync(swiftSource)) {
  console.error(`[permission-flow] Swift source not found at ${swiftSource}`);
  process.exit(1);
}

ensureDir(outputDir);
ensureDir(moduleCacheDir);

let needsBuild = true;
if (fs.existsSync(outputBinary) && verifyBinaryArch(outputBinary, targetArch)) {
  try {
    const sourceContent = fs.readFileSync(swiftSource, "utf8");
    const currentHash = crypto.createHash("sha256").update(sourceContent).digest("hex");
    const savedHash = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim() : "";
    needsBuild = savedHash !== currentHash;
  } catch {
    needsBuild = true;
  }
}

if (!needsBuild) {
  process.exit(0);
}

function attemptCompile(command, args) {
  log(`Compiling with ${[command, ...args].join(" ")}`);
  return spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      SWIFT_MODULE_CACHE_PATH: moduleCacheDir,
    },
  });
}

const compileArgs = [
  swiftSource,
  "-O",
  "-target",
  swiftTarget,
  "-module-cache-path",
  moduleCacheDir,
  "-o",
  outputBinary,
];

let result = attemptCompile("xcrun", ["swiftc", ...compileArgs]);
if (result.status !== 0) {
  result = attemptCompile("swiftc", compileArgs);
}
if (result.status !== 0) {
  console.error("[permission-flow] Failed to compile macOS permission flow helper.");
  process.exit(result.status ?? 1);
}

fs.chmodSync(outputBinary, 0o755);
if (!verifyBinaryArch(outputBinary, targetArch)) {
  console.error(`[permission-flow] Compiled binary does not match target arch ${targetArch}.`);
  process.exit(1);
}

const sourceContent = fs.readFileSync(swiftSource, "utf8");
const hash = crypto.createHash("sha256").update(sourceContent).digest("hex");
fs.writeFileSync(hashFile, hash);
log(`Successfully built macOS permission flow helper (${targetArch}).`);

