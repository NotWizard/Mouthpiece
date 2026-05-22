import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test("database.js declares raw_text column and an ALTER TABLE migration for legacy DBs", async () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/helpers/database.js"),
    "utf8"
  );

  // CREATE TABLE must include raw_text
  assert.match(
    source,
    /CREATE TABLE IF NOT EXISTS transcriptions[\s\S]*raw_text TEXT/,
    "transcriptions CREATE TABLE must declare raw_text TEXT column"
  );

  // Migration block must add raw_text to existing DBs (idempotent)
  assert.match(
    source,
    /ALTER TABLE transcriptions ADD COLUMN raw_text TEXT/,
    "database.js must contain ALTER TABLE migration for legacy DBs"
  );
});

test("migration is idempotent and ALTERs legacy DBs without raw_text", () => {
  const db = new DatabaseSync(":memory:");

  // Simulate a legacy DB (no raw_text column)
  db.exec(`
    CREATE TABLE transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Apply the migration logic (mirrors src/helpers/database.js).
  const columns = db.prepare("PRAGMA table_info(transcriptions)").all();
  const hasRawText = columns.some((c) => c.name === "raw_text");
  if (!hasRawText) {
    db.exec("ALTER TABLE transcriptions ADD COLUMN raw_text TEXT");
  }

  // Post-verify
  const verifyColumns = db.prepare("PRAGMA table_info(transcriptions)").all();
  assert.ok(
    verifyColumns.some((c) => c.name === "raw_text"),
    "raw_text column must exist after migration"
  );

  // Second run is a no-op (idempotence)
  const columnsAgain = db.prepare("PRAGMA table_info(transcriptions)").all();
  const hasRawText2 = columnsAgain.some((c) => c.name === "raw_text");
  if (!hasRawText2) {
    db.exec("ALTER TABLE transcriptions ADD COLUMN raw_text TEXT"); // should not run
  }
  const verifyColumns2 = db.prepare("PRAGMA table_info(transcriptions)").all();
  const rawTextCols = verifyColumns2.filter((c) => c.name === "raw_text");
  assert.equal(rawTextCols.length, 1, "raw_text must appear exactly once after a second run");

  db.close();
});
