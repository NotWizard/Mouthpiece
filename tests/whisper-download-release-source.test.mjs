import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

test("whisper download script no longer points at the removed Mouthpiece fork", () => {
  const scriptPath = path.join(repoRoot, "scripts", "download-whisper-cpp.js");
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.ok(
    !source.includes("Mouthpiece/whisper.cpp"),
    "download-whisper-cpp.js should not target the removed Mouthpiece/whisper.cpp release repo"
  );
  assert.ok(
    source.includes("ggml-org/whisper.cpp"),
    "download-whisper-cpp.js should target the official ggml-org/whisper.cpp upstream"
  );
});

test("whisper download script includes a source-build fallback for CI", () => {
  const scriptPath = path.join(repoRoot, "scripts", "download-whisper-cpp.js");
  const source = fs.readFileSync(scriptPath, "utf8");

  assert.match(
    source,
    /buildWhisperServerFromSource|buildFromSource/,
    "download-whisper-cpp.js should be able to build whisper-server from source when prebuilt assets are unavailable"
  );
  assert.ok(
    source.includes('"-DWHISPER_BUILD_EXAMPLES=ON"'),
    "download-whisper-cpp.js should keep upstream examples enabled because whisper-server is defined under examples/server"
  );
  assert.match(
    source,
    /"--target",\s*"whisper-server"/,
    "download-whisper-cpp.js should build the whisper-server target explicitly"
  );
});

test("windows helper download scripts point at the current Mouthpiece repository", () => {
  const scripts = [
    "scripts/download-windows-fast-paste.js",
    "scripts/download-windows-key-listener.js",
  ];

  for (const relativePath of scripts) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.ok(
      source.includes('const REPO = "NotWizard/Mouthpiece"'),
      `${relativePath} should download releases from the current NotWizard/Mouthpiece repository`
    );
    assert.ok(
      !source.includes('const REPO = "le-soleil-se-couche/Mouthpiece"'),
      `${relativePath} should not reference the removed le-soleil-se-couche/Mouthpiece fork`
    );
  }
});

test("llama download script skips the GitHub API when the current binary already exists", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "download-llama-server.js"),
    "utf8"
  );

  assert.match(
    source,
    /Skipping release fetch because the binary already exists/,
    "download-llama-server.js should short-circuit before fetching release metadata when the target binary is already present"
  );
});

test("macOS workflows pin dedicated runners for x64 and arm64 builds", () => {
  const workflows = [
    ".github/workflows/release.yml",
    ".github/workflows/build-and-notarize.yml",
  ];

  for (const relativePath of workflows) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    assert.ok(
      source.includes("runner: macos-15-intel"),
      `${relativePath} should use the Intel macOS runner for x64 packaging`
    );
    assert.ok(
      source.includes("runner: macos-15"),
      `${relativePath} should use the arm64 macOS runner for Apple Silicon packaging`
    );
    assert.ok(
      !source.includes("build-macos:\n    runs-on: macos-latest"),
      `${relativePath} should not run both macOS architectures on the same macos-latest runner label`
    );
  }
});
