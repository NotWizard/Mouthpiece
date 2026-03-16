import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("successful hotkey capture explicitly exits listening mode before blur fallback", async () => {
  const source = await fs.readFile(
    path.resolve(process.cwd(), "src/components/ui/HotkeyInput.tsx"),
    "utf8"
  );

  assert.match(
    source,
    /const finalizeCapture = useCallback\([\s\S]*window\.electronAPI\?\.setHotkeyListeningMode\?\.\(false,\s*hotkey\);/
  );
  assert.match(
    source,
    /const handleBlur = useCallback\(\(\) => \{[\s\S]*window\.electronAPI\?\.setHotkeyListeningMode\?\.\(false,\s*lastCapturedHotkeyRef\.current\);/
  );
});
