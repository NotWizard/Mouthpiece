import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// The hotkey-translation-prefix invariant introduced in P9.1 requires the
// translation hotkey to carry every modifier of the main hotkey as a prefix.
// For a Globe/Fn-only main hotkey this means "GLOBE" itself must count as a
// modifier when the validator inspects the translation candidate. Earlier
// drafts of the validator forgot to recognise GLOBE/Fn as modifier-eligible
// tokens, so this test is the source-pattern guard against regressions.
//
// We can't import the .ts file directly from a .mjs test, so we read the
// source and assert the critical fragments are present. This is intentionally
// brittle on prose so a future refactor doesn't silently drop the fix.
const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/utils/hotkeyValidator.ts"),
  "utf8"
);

test("isModifierPart recognises GLOBE/Fn as modifier-eligible tokens", () => {
  assert.ok(
    /isModifierPart[\s\S]*?if \(part === "GLOBE" \|\| part === "Fn"\) return true;/.test(source),
    "expected isModifierPart to short-circuit on GLOBE/Fn so containsAllModifiersOf treats Globe-only mains as having a 'GLOBE' modifier prefix"
  );
});

test("isModifierOnlyAccelerator accepts Globe/Fn as modifier-only hotkeys", () => {
  assert.ok(
    /isModifierOnlyAccelerator[\s\S]*?if \(part === "GLOBE" \|\| part === "Fn"\) return true;/.test(
      source
    ),
    "expected isModifierOnlyAccelerator to allow GLOBE/Fn so the main hotkey input doesn't flag the macOS default as non-modifier-only"
  );
});
