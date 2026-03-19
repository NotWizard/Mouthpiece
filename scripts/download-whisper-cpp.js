#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  downloadFile,
  extractArchive,
  findBinaryInDir,
  parseArgs,
  setExecutable,
  cleanupFiles,
} = require("./lib/download-utils");

const WHISPER_CPP_UPSTREAM_REPO = "ggml-org/whisper.cpp";

// Pin the upstream source tag so CI does not depend on a mutable "latest" API response.
const VERSION_OVERRIDE = process.env.WHISPER_CPP_VERSION || "v1.8.3";

const BINARIES = {
  "darwin-arm64": {
    binaryName: "whisper-server",
    outputName: "whisper-server-darwin-arm64",
    cmakeArch: "arm64",
    companionPattern: /\.dylib$/i,
  },
  "darwin-x64": {
    binaryName: "whisper-server",
    outputName: "whisper-server-darwin-x64",
    cmakeArch: "x86_64",
    companionPattern: /\.dylib$/i,
  },
  "win32-x64": {
    binaryName: "whisper-server.exe",
    outputName: "whisper-server-win32-x64.exe",
    companionPattern: /\.dll$/i,
  },
  "linux-x64": {
    binaryName: "whisper-server",
    outputName: "whisper-server-linux-x64",
    companionPattern: /\.so(\.\d+)*$/i,
  },
};

const BIN_DIR = path.join(__dirname, "..", "resources", "bin");

function getOutputPath(config) {
  return path.join(BIN_DIR, config.outputName);
}

function findFilesInDir(dir, predicate, maxDepth = 8, currentDepth = 0) {
  if (currentDepth > maxDepth) return [];

  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findFilesInDir(fullPath, predicate, maxDepth, currentDepth + 1));
      continue;
    }

    if (predicate(entry.name, fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function getExtractedSourceRoot(extractDir) {
  const entries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory()
  );
  if (entries.length !== 1) {
    throw new Error(`Expected one extracted source directory in ${extractDir}, found ${entries.length}`);
  }
  return path.join(extractDir, entries[0].name);
}

function getSourceArchiveUrl(version) {
  return `https://github.com/${WHISPER_CPP_UPSTREAM_REPO}/archive/refs/tags/${version}.tar.gz`;
}

function getConfigureArgs(sourceDir, buildDir, config) {
  const args = [
    "-S",
    sourceDir,
    "-B",
    buildDir,
    "-DWHISPER_BUILD_SERVER=ON",
    "-DWHISPER_BUILD_EXAMPLES=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_SDL2=OFF",
    "-DCMAKE_BUILD_TYPE=Release",
  ];

  if (process.platform === "darwin" && config.cmakeArch) {
    args.push(`-DCMAKE_OSX_ARCHITECTURES=${config.cmakeArch}`);
  }

  return args;
}

function copyCompanionLibraries(buildDir, config) {
  if (!config.companionPattern) return [];

  const libraries = findFilesInDir(buildDir, (name) => config.companionPattern.test(name));
  const copiedNames = new Set();

  for (const libraryPath of libraries) {
    const fileName = path.basename(libraryPath);
    if (copiedNames.has(fileName)) continue;

    const destination = path.join(BIN_DIR, fileName);
    fs.copyFileSync(libraryPath, destination);
    setExecutable(destination);
    copiedNames.add(fileName);
  }

  return [...copiedNames];
}

async function buildWhisperServerFromSource(platformArch, config, version, isForce = false) {
  if (!config) {
    console.log(`  [server] ${platformArch}: Not supported`);
    return false;
  }

  const outputPath = getOutputPath(config);
  if (fs.existsSync(outputPath) && !isForce) {
    console.log(`  [server] ${platformArch}: Already exists (use --force to re-download)`);
    return true;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `whisper-source-${platformArch}-`));
  const archivePath = path.join(tempRoot, `${version}.tar.gz`);
  const extractDir = path.join(tempRoot, "src");
  const buildDir = path.join(tempRoot, "build");

  try {
    const sourceArchiveUrl = getSourceArchiveUrl(version);
    console.log(`  [server] ${platformArch}: Downloading source archive ${version}`);
    await downloadFile(sourceArchiveUrl, archivePath);
    fs.mkdirSync(extractDir, { recursive: true });
    await extractArchive(archivePath, extractDir);

    const sourceDir = getExtractedSourceRoot(extractDir);
    const configureArgs = getConfigureArgs(sourceDir, buildDir, config);

    console.log(`  [server] ${platformArch}: Configuring whisper.cpp build`);
    execFileSync("cmake", configureArgs, { stdio: "inherit" });

    console.log(`  [server] ${platformArch}: Building whisper-server from source`);
    execFileSync("cmake", ["--build", buildDir, "--config", "Release", "--parallel"], {
      stdio: "inherit",
    });

    const binaryPath = findBinaryInDir(buildDir, config.binaryName);
    if (binaryPath) {
      fs.copyFileSync(binaryPath, outputPath);
      setExecutable(outputPath);
      const copiedLibraries = copyCompanionLibraries(buildDir, config);
      if (copiedLibraries.length > 0) {
        console.log(`  [server] ${platformArch}: Copied ${copiedLibraries.length} companion libraries`);
      }
      console.log(`  [server] ${platformArch}: Built ${config.outputName} from source`);
    } else {
      console.error(
        `  [server] ${platformArch}: Binary "${config.binaryName}" not found in build output`
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error(`  [server] ${platformArch}: Failed - ${error.message}`);
    return false;
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const args = parseArgs();
  fs.mkdirSync(BIN_DIR, { recursive: true });

  if (args.isCurrent) {
    const config = BINARIES[args.platformArch];

    if (!config) {
      console.error(`Unsupported platform/arch: ${args.platformArch}`);
      process.exitCode = 1;
      return;
    }

    const outputPath = getOutputPath(config);
    if (fs.existsSync(outputPath) && !args.isForce) {
      console.log(`\n[whisper-server] ${args.platformArch}: already available at ${config.outputName}`);
      console.log("[whisper-server] Skipping release fetch because the binary already exists.");

      if (args.shouldCleanup) {
        cleanupFiles(BIN_DIR, "whisper-server", `whisper-server-${args.platformArch}`);
      }
      return;
    }
  }

  console.log(`\n[whisper-server] Building upstream source ${VERSION_OVERRIDE} from ${WHISPER_CPP_UPSTREAM_REPO}\n`);

  if (args.isCurrent) {
    if (!BINARIES[args.platformArch]) {
      console.error(`Unsupported platform/arch: ${args.platformArch}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Building for target platform (${args.platformArch}):`);
    const ok = await buildWhisperServerFromSource(
      args.platformArch,
      BINARIES[args.platformArch],
      VERSION_OVERRIDE,
      args.isForce
    );
    if (!ok) {
      console.error(`Failed to prepare binaries for ${args.platformArch}`);
      process.exitCode = 1;
      return;
    }

    if (args.shouldCleanup) {
      cleanupFiles(BIN_DIR, "whisper-server", `whisper-server-${args.platformArch}`);
    }
  } else {
    console.error("Building whisper.cpp for all platforms from a single host is not supported.");
    console.error("Run the script with --current on the matching target runner instead.");
    process.exitCode = 1;
    return;
  }

  console.log("\n---");

  const files = fs.readdirSync(BIN_DIR).filter((f) => f.startsWith("whisper-server"));
  if (files.length > 0) {
    console.log("Available whisper-server binaries:\n");
    files.forEach((f) => {
      const stats = fs.statSync(path.join(BIN_DIR, f));
      console.log(`  - ${f} (${Math.round(stats.size / 1024 / 1024)}MB)`);
    });
  } else {
    console.log("No binaries downloaded yet.");
    console.log(`\nCheck upstream source tags: https://github.com/${WHISPER_CPP_UPSTREAM_REPO}/tags`);
  }
}

main().catch(console.error);
