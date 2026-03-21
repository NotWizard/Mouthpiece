import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();

async function importContextClassifier() {
  const moduleUrl = `${pathToFileURL(
    path.resolve(repoRoot, "src/utils/contextClassifier.ts")
  ).href}?ts=${Date.now()}`;
  return import(moduleUrl);
}

function withLocalStorage(values, fn) {
  const previousWindow = global.window;
  global.window = {
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
    },
  };

  try {
    return fn();
  } finally {
    if (previousWindow === undefined) {
      delete global.window;
    } else {
      global.window = previousWindow;
    }
  }
}

test("context classifier detects IDE and markdown contexts conservatively", async () => {
  const mod = await importContextClassifier();

  const ideResult = withLocalStorage({}, () =>
    mod.classifyContext({
      text: "please keep the variable name userId exactly as spoken",
      targetApp: {
        appName: "Visual Studio Code",
        processId: 101,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
      agentName: "Mouthpiece",
    })
  );

  const markdownResult = withLocalStorage({}, () =>
    mod.classifyContext({
      text: "# Sprint notes\n- finish release prep\n- update changelog",
      targetApp: {
        appName: "Obsidian",
        processId: 202,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
      agentName: "Mouthpiece",
    })
  );

  assert.equal(ideResult.context, "ide");
  assert.match(ideResult.signals.join(","), /app:ide/);
  assert.equal(ideResult.intent, "cleanup");

  assert.equal(markdownResult.context, "markdown");
  assert.match(markdownResult.signals.join(","), /text:markdown/);
});

test("context classifier detects search and form surfaces from app and content signals", async () => {
  const mod = await importContextClassifier();

  const searchResult = withLocalStorage({}, () =>
    mod.classifyContext({
      text: "best dim sum shanghai",
      targetApp: {
        appName: "Raycast",
        processId: 303,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
    })
  );

  const formResult = withLocalStorage({}, () =>
    mod.classifyContext({
      text: "First name: Ada\nEmail: ada@example.com",
      targetApp: {
        appName: "Typeform",
        processId: 404,
        platform: "darwin",
        source: "main-process",
        capturedAt: null,
      },
    })
  );

  assert.equal(searchResult.context, "search");
  assert.match(searchResult.signals.join(","), /app:search/);
  assert.equal(formResult.context, "form");
  assert.match(formResult.signals.join(","), /(app:form|text:form)/);
});
