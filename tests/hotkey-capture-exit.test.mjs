import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("hotkey builder captures only the primary key locally and no longer uses listening-mode IPC", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/components/ui/HotkeyInput.tsx"),
    "utf8"
  );

  assert.match(source, /HOTKEY_BUILDER_MODES\.modifierOnly/);
  assert.match(source, /HOTKEY_BUILDER_MODES\.keyCombo/);
  assert.match(source, /getPrimaryKeyFromEvent/);
  assert.match(source, /onKeyDown=\{handlePrimaryKeyCapture\}/);
  assert.match(source, /draft\.selectedModifiers\.length === 0/);
  assert.match(source, /hotkeyInput\.comboModifierHint/);
  assert.match(source, /hotkeyInput\.primaryKeyRequiresModifier/);
  assert.doesNotMatch(source, /hotkeyInput\.modes\.singleKey/);
  assert.doesNotMatch(source, /setHotkeyListeningMode/);
});
