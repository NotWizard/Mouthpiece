import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const modulePath = path.resolve(process.cwd(), "src/utils/correctionLearner.js");

test("correction learner emits pending review suggestions with provenance metadata", async () => {
  const mod = await import(modulePath);

  const suggestions = mod.extractCorrectionSuggestions(
    "please open race cast",
    "please open Raycast",
    ["Gmail"]
  );

  assert.equal(Array.isArray(suggestions), true);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].term, "Raycast");
  assert.equal(suggestions[0].sourceTerm, "race cast");
  assert.equal(suggestions[0].source, "auto_learn_edit");
});

test("correction learner keeps extractCorrections backwards compatible while suggestions stay reviewable", async () => {
  const mod = await import(modulePath);

  const corrections = mod.extractCorrections("please open race cast", "please open Raycast", []);

  assert.deepEqual(corrections, ["Raycast"]);
});
