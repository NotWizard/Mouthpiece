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

test("text monitor download script points at the current Mouthpiece repository", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "download-text-monitor.js"),
    "utf8"
  );

  assert.ok(
    source.includes('const REPO = "NotWizard/Mouthpiece"'),
    "download-text-monitor.js should download releases from the current NotWizard/Mouthpiece repository"
  );
  assert.ok(
    !source.includes('const REPO = "le-soleil-se-couche/Mouthpiece"'),
    "download-text-monitor.js should not reference the removed le-soleil-se-couche/Mouthpiece fork"
  );
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

test("download utilities use a CI-friendly timeout for large release assets", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, "scripts", "lib", "download-utils.js"),
    "utf8"
  );

  assert.match(
    source,
    /const REQUEST_TIMEOUT = 120000;/,
    "download-utils.js should allow at least 120 seconds for large GitHub release downloads in CI"
  );
});

test("macOS workflows pin dedicated runners for x64 and arm64 builds", () => {
  const workflows = [".github/workflows/release.yml", ".github/workflows/build-and-notarize.yml"];

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

test("macOS packaging workflows can fall back when Apple signing secrets are unavailable", () => {
  const workflows = [".github/workflows/release.yml", ".github/workflows/build-and-notarize.yml"];

  for (const relativePath of workflows) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    assert.ok(
      source.includes("APPLE_SIGNING_ENABLED"),
      `${relativePath} should compute whether Apple signing secrets are actually available`
    );
    assert.ok(
      source.includes("if: env.APPLE_SIGNING_ENABLED == 'true'"),
      `${relativePath} should skip macOS signing setup when signing secrets are unavailable`
    );
    assert.ok(
      source.includes(
        "CSC_IDENTITY_AUTO_DISCOVERY: ${{ env.APPLE_SIGNING_ENABLED == 'true' && 'true' || 'false' }}"
      ),
      `${relativePath} should disable code-signing auto-discovery when signing is unavailable`
    );
  }
});

test("Release workflow installs Linux native build dependencies before packaging", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release.yml"),
    "utf8"
  );

  assert.ok(
    source.includes(
      "sudo apt-get install -y rpm pkg-config libx11-dev libxtst-dev libatspi2.0-dev libglib2.0-dev"
    ),
    "release.yml should install the Linux native build dependencies required by compile:native"
  );
});

test("Windows packaging workflows prepare MSVC for native fallback compilation", () => {
  const workflows = [".github/workflows/release.yml", ".github/workflows/build-and-notarize.yml"];

  for (const relativePath of workflows) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    assert.ok(
      source.includes("Setup MSVC"),
      `${relativePath} should install MSVC tooling before native Windows fallback compilation`
    );
    assert.ok(
      source.includes("Setup MSVC environment"),
      `${relativePath} should initialize the MSVC developer environment before native Windows fallback compilation`
    );
  }
});

test("Release workflow falls back to GitHub's built-in token for authenticated publishing", () => {
  const source = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "release.yml"),
    "utf8"
  );

  assert.ok(
    source.includes("GH_TOKEN: ${{ secrets.GH_TOKEN || github.token }}"),
    "release.yml should let electron-builder publish with github.token when the custom GH_TOKEN secret is absent"
  );
  assert.ok(
    source.includes("GITHUB_TOKEN: ${{ secrets.GH_TOKEN || github.token }}"),
    "release.yml should let authenticated GitHub release downloads fall back to github.token when the custom GH_TOKEN secret is absent"
  );
  assert.ok(
    !source.includes("GH_TOKEN: ${{ secrets.GH_TOKEN }}"),
    "release.yml should not rely on a custom GH_TOKEN secret alone for publishing or release uploads"
  );
  assert.ok(
    !source.includes("GITHUB_TOKEN: ${{ secrets.GH_TOKEN }}"),
    "release.yml should not rely on a custom GH_TOKEN secret alone for release asset downloads"
  );
});

test("Text monitor helper release workflows are manual-only", () => {
  const workflows = [
    ".github/workflows/build-linux-text-monitor.yml",
    ".github/workflows/build-windows-text-monitor.yml",
  ];

  for (const relativePath of workflows) {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    assert.ok(
      source.includes("workflow_dispatch:"),
      `${relativePath} should remain manually runnable`
    );
    assert.ok(!source.includes("\n  push:\n"), `${relativePath} should not auto-run on every push`);
  }
});
