const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const debugLogger = require("./debugLogger");
const { app } = require("electron");

class DatabaseManager {
  constructor() {
    this.db = null;
    // Prepared-statement cache populated by initDatabase(). better-sqlite3
    // explicitly warns against re-preparing the same SQL on every call;
    // every dictation hits saveTranscription + the post-insert SELECT, so
    // caching is the cheap win.
    this.stmts = null;
    this.initDatabase();
  }

  initDatabase() {
    try {
      const dbFileName =
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db";

      const dbPath = path.join(app.getPath("userData"), dbFileName);

      this.db = new Database(dbPath);
      this.db.pragma("journal_mode = WAL");

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS transcriptions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          text TEXT NOT NULL,
          raw_text TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Idempotent backfill of raw_text for legacy DBs.
      try {
        const columns = this.db.prepare("PRAGMA table_info(transcriptions)").all();
        const hasRawText = columns.some((c) => c.name === "raw_text");
        if (!hasRawText) {
          this.db.exec("ALTER TABLE transcriptions ADD COLUMN raw_text TEXT");
        }
      } catch (error) {
        debugLogger.error(
          "raw_text migration failed",
          { error: error.message },
          "database"
        );
      }

      // Post-verify: if ALTER silently failed, fail fast here so callers don't hit
      // a delayed "no such column: raw_text" later in saveTranscription/getTranscriptions.
      const verifyColumns = this.db.prepare("PRAGMA table_info(transcriptions)").all();
      if (!verifyColumns.some((c) => c.name === "raw_text")) {
        throw new Error(
          "transcriptions.raw_text column missing after migration attempt"
        );
      }

      // History list (`getTranscriptions`) is ORDER BY timestamp DESC LIMIT N,
      // which without an index forces a full-table scan + sort. The index
      // makes the hot path O(log n) and lets sqlite stream rows directly.
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp ON transcriptions(timestamp DESC)"
      );

      this.db.exec(`
        CREATE TABLE IF NOT EXISTS custom_dictionary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          word TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Cache prepared statements once. Transactions wrap pre-prepared
      // statements too so setDictionary doesn't re-prepare the DELETE +
      // INSERT pair on every save.
      this.stmts = {
        insertTranscription: this.db.prepare(
          "INSERT INTO transcriptions (text, raw_text) VALUES (?, ?)"
        ),
        selectTranscriptionById: this.db.prepare(
          "SELECT * FROM transcriptions WHERE id = ?"
        ),
        listTranscriptions: this.db.prepare(
          "SELECT * FROM transcriptions ORDER BY timestamp DESC LIMIT ?"
        ),
        deleteAllTranscriptions: this.db.prepare("DELETE FROM transcriptions"),
        deleteTranscriptionById: this.db.prepare(
          "DELETE FROM transcriptions WHERE id = ?"
        ),
        listDictionary: this.db.prepare(
          "SELECT word FROM custom_dictionary ORDER BY id ASC"
        ),
        deleteAllDictionary: this.db.prepare("DELETE FROM custom_dictionary"),
        insertDictionaryWord: this.db.prepare(
          "INSERT OR IGNORE INTO custom_dictionary (word) VALUES (?)"
        ),
      };

      this.replaceDictionaryTxn = this.db.transaction((wordList) => {
        this.stmts.deleteAllDictionary.run();
        for (const word of wordList) {
          const trimmed = typeof word === "string" ? word.trim() : "";
          if (trimmed) {
            this.stmts.insertDictionaryWord.run(trimmed);
          }
        }
      });

      return true;
    } catch (error) {
      debugLogger.error("Database initialization failed", { error: error.message }, "database");
      throw error;
    }
  }

  saveTranscription(text, rawText) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const result = this.stmts.insertTranscription.run(text, rawText ?? null);
      const transcription = this.stmts.selectTranscriptionById.get(result.lastInsertRowid);
      return { id: result.lastInsertRowid, success: true, transcription };
    } catch (error) {
      debugLogger.error("Error saving transcription", { error: error.message }, "database");
      throw error;
    }
  }

  getTranscriptions(limit = 50) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      return this.stmts.listTranscriptions.all(limit);
    } catch (error) {
      debugLogger.error("Error getting transcriptions", { error: error.message }, "database");
      throw error;
    }
  }

  clearTranscriptions() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const result = this.stmts.deleteAllTranscriptions.run();
      return { cleared: result.changes, success: true };
    } catch (error) {
      debugLogger.error("Error clearing transcriptions", { error: error.message }, "database");
      throw error;
    }
  }

  deleteTranscription(id) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      const result = this.stmts.deleteTranscriptionById.run(id);
      return { success: result.changes > 0, id };
    } catch (error) {
      debugLogger.error("Error deleting transcription", { error: error.message }, "database");
      throw error;
    }
  }

  getDictionary() {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      return this.stmts.listDictionary.all().map((row) => row.word);
    } catch (error) {
      debugLogger.error("Error getting dictionary", { error: error.message }, "database");
      throw error;
    }
  }

  setDictionary(words) {
    try {
      if (!this.db) {
        throw new Error("Database not initialized");
      }
      this.replaceDictionaryTxn(words);
      return { success: true };
    } catch (error) {
      debugLogger.error("Error setting dictionary", { error: error.message }, "database");
      throw error;
    }
  }

  cleanup() {
    try {
      const dbPath = path.join(
        app.getPath("userData"),
        process.env.NODE_ENV === "development" ? "transcriptions-dev.db" : "transcriptions.db"
      );
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
    } catch (error) {
      debugLogger.error("Error deleting database file", { error: error.message }, "database");
    }
  }
}

module.exports = DatabaseManager;
