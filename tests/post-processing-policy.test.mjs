import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

async function importPolicyModule() {
  const moduleUrl = `${pathToFileURL(
    path.resolve(repoRoot, "src/utils/postProcessingPolicy.ts")
  ).href}?ts=${Date.now()}`;
  return import(moduleUrl);
}

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(repoRoot, relativePath), "utf8");
}

test("post-processing policy keeps IDE and search surfaces on conservative raw-first output", async () => {
  const mod = await importPolicyModule();

  assert.equal(typeof mod.resolvePostProcessingPolicy, "function");

  const idePolicy = mod.resolvePostProcessingPolicy({
    contextClassification: {
      context: "ide",
      intent: "cleanup",
      confidence: 0.9,
      strictMode: true,
      strictOverlapThreshold: 0.72,
      signals: ["app:ide"],
      targetApp: {
        appName: "Visual Studio Code",
        processId: 42,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
    },
  });

  const searchPolicy = mod.resolvePostProcessingPolicy({
    contextClassification: {
      context: "search",
      intent: "cleanup",
      confidence: 0.88,
      strictMode: true,
      strictOverlapThreshold: 0.72,
      signals: ["app:search"],
      targetApp: {
        appName: "Raycast",
        processId: 7,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
    },
  });

  assert.equal(idePolicy.surfaceMode, "ide");
  assert.equal(idePolicy.outputStrategy, "raw_first");
  assert.equal(idePolicy.allowStructuredRewrite, false);
  assert.equal(idePolicy.preserveIdentifiers, true);

  assert.equal(searchPolicy.surfaceMode, "search");
  assert.equal(searchPolicy.outputStrategy, "raw_first");
  assert.equal(searchPolicy.allowStructuredRewrite, false);
  assert.equal(searchPolicy.preserveIdentifiers, false);
});

test("post-processing policy allows richer polish for email and document instruction flows", async () => {
  const mod = await importPolicyModule();

  const emailPolicy = mod.resolvePostProcessingPolicy({
    contextClassification: {
      context: "email",
      intent: "cleanup",
      confidence: 0.8,
      strictMode: true,
      strictOverlapThreshold: 0.72,
      signals: ["app:email"],
      targetApp: {
        appName: "Mail",
        processId: 11,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
    },
  });

  const documentInstructionPolicy = mod.resolvePostProcessingPolicy({
    contextClassification: {
      context: "document",
      intent: "instruction",
      confidence: 0.91,
      strictMode: false,
      strictOverlapThreshold: 0.72,
      signals: ["text:document", "intent:agent_direct_address"],
      targetApp: {
        appName: "Notion",
        processId: 18,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
    },
  });

  assert.equal(emailPolicy.surfaceMode, "email");
  assert.equal(emailPolicy.outputStrategy, "publishable");
  assert.equal(emailPolicy.allowStructuredRewrite, false);

  assert.equal(documentInstructionPolicy.surfaceMode, "document");
  assert.equal(documentInstructionPolicy.outputStrategy, "structured_rewrite");
  assert.equal(documentInstructionPolicy.allowStructuredRewrite, true);
});

test("prompt contract consumes identifier and formatting preservation policy hints", async () => {
  const source = await readRepoFile("src/config/prompts.ts");

  assert.match(source, /function getPolicyInstruction/);
  assert.match(source, /policy\.preserveIdentifiers/);
  assert.match(source, /policy\.preserveFormatting/);
  assert.match(source, /Preserve identifiers, symbols, casing, filenames, and code-like tokens exactly\./);
  assert.match(
    source,
    /Preserve visible formatting, list markers, Markdown structure, and intentional line breaks\./
  );
});
