#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_IDENTITY = "Mouthpiece Local Codesign";
const DEFAULT_APP_NAME = "Mouthpiece.app";

function pathExists(candidate) {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function findAppBundles(searchRoot = path.resolve(__dirname, "..", "dist")) {
  const found = [];

  function walk(dir, depth = 0) {
    if (depth > 4 || !pathExists(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name.endsWith(".app")) {
        found.push(fullPath);
      } else if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  }

  walk(searchRoot);
  return found.filter((candidate) => path.basename(candidate) === DEFAULT_APP_NAME);
}

function defaultNestedCandidates(appPath) {
  return [
    path.join(appPath, "Contents", "MacOS", "Mouthpiece"),
    path.join(appPath, "Contents", "Resources", "bin", "macos-permission-flow"),
    path.join(appPath, "Contents", "Resources", "bin", "macos-fast-paste"),
    path.join(appPath, "Contents", "Resources", "bin", "macos-globe-listener"),
    path.join(appPath, "Contents", "Resources", "bin", "macos-text-monitor"),
  ];
}

function isNestedCodeCandidate(appPath, candidate) {
  const relative = path.relative(appPath, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }

  const basename = path.basename(candidate);
  if (basename.endsWith(".app") || basename.endsWith(".framework")) {
    return true;
  }
  if (basename.endsWith(".dylib") || basename.endsWith(".so") || basename.endsWith(".node")) {
    return true;
  }

  const macOSDir = `Contents${path.sep}MacOS${path.sep}`;
  const resourcesBinDir = `Contents${path.sep}Resources${path.sep}bin${path.sep}`;
  return relative.startsWith(macOSDir) || relative.startsWith(resourcesBinDir);
}

function collectNestedCandidates(appPath, { existingPaths } = {}) {
  const candidates = new Set();

  for (const candidate of defaultNestedCandidates(appPath)) {
    if (!existingPaths && pathExists(candidate)) {
      candidates.add(candidate);
    }
  }

  if (existingPaths) {
    for (const candidate of existingPaths) {
      if (isNestedCodeCandidate(appPath, candidate)) {
        candidates.add(candidate);
      }
    }
  } else {
    const frameworksDir = path.join(appPath, "Contents", "Frameworks");
    const walk = (dir, depth = 0) => {
      if (depth > 6 || !pathExists(dir)) return;

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (isNestedCodeCandidate(appPath, fullPath)) {
            candidates.add(fullPath);
            continue;
          }
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && isNestedCodeCandidate(appPath, fullPath)) {
          candidates.add(fullPath);
        }
      }
    };

    walk(frameworksDir);
  }

  return Array.from(candidates).sort((a, b) => {
    const depthA = path.relative(appPath, a).split(path.sep).length;
    const depthB = path.relative(appPath, b).split(path.sep).length;
    if (depthA !== depthB) return depthB - depthA;
    return a.localeCompare(b);
  });
}

function buildCodesignArgs({ identity, target, entitlementsPath, isAppBundle = false }) {
  const args = ["--force", "--sign", identity, "--timestamp=none", "--options", "runtime"];
  if (isAppBundle) {
    args.push("--entitlements", entitlementsPath);
  }
  args.push(target);
  return args;
}

function buildCodesignPlan({
  appPath,
  identity = DEFAULT_IDENTITY,
  entitlementsPath = path.resolve(__dirname, "..", "resources", "mac", "entitlements.mac.plist"),
  existingPaths,
} = {}) {
  if (!appPath) {
    throw new Error("appPath is required");
  }

  const exists = existingPaths
    ? (candidate) => existingPaths.has(candidate)
    : (candidate) => pathExists(candidate);
  const plan = [];

  for (const target of collectNestedCandidates(appPath, { existingPaths })) {
    if (exists(target)) {
      plan.push({
        target,
        args: buildCodesignArgs({
          identity,
          target,
          entitlementsPath,
          isAppBundle: target.endsWith(".app"),
        }),
      });
    }
  }

  plan.push({
    target: appPath,
    args: buildCodesignArgs({ identity, target: appPath, entitlementsPath, isAppBundle: true }),
  });

  return plan;
}

function runCodesignPlan(plan) {
  for (const step of plan) {
    console.log(`[codesign] Signing ${step.target}`);
    const result = spawnSync("codesign", step.args, { stdio: "inherit" });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  }
}

function main() {
  if (process.platform !== "darwin") {
    console.log("[codesign] Skipping local macOS codesign on non-macOS platform.");
    return;
  }

  const identity = process.env.MOUTHPIECE_LOCAL_CODESIGN_IDENTITY || DEFAULT_IDENTITY;
  const appPath = process.argv[2] ? path.resolve(process.argv[2]) : findAppBundles()[0];
  if (!appPath) {
    console.error("[codesign] Could not find dist/**/Mouthpiece.app. Pass the app path explicitly.");
    process.exit(1);
  }

  const plan = buildCodesignPlan({ appPath, identity });
  runCodesignPlan(plan);

  console.log("[codesign] Verifying app signature");
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
    stdio: "inherit",
  });
  if (verify.status !== 0) {
    process.exit(verify.status ?? 1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_IDENTITY,
  buildCodesignArgs,
  buildCodesignPlan,
  collectNestedCandidates,
  defaultNestedCandidates,
  findAppBundles,
};
