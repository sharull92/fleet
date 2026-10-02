/* SQLite storage (local / Docker / VPS). Uses Node's built-in node:sqlite. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

module.exports = function createSqliteStore(dataDir) {
  process.removeAllListeners("warning"); // silence node:sqlite ExperimentalWarning
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "fleet.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS kv_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      role TEXT NOT NULL,
      saved_at TEXT NOT NULL
    );
  `);
  const stmtGet = db.prepare("SELECT value, version, updated_at FROM kv WHERE key = ?");
  const stmtAll = db.prepare("SELECT key, value, version, updated_at FROM kv");
  const stmtUpsert = db.prepare(`
    INSERT INTO kv (key, value, version, updated_at) VALUES (?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, version = kv.version + 1, updated_at = excluded.updated_at
  `);
  const stmtHistory = db.prepare("INSERT INTO kv_history (key, value, role, saved_at) VALUES (?, ?, ?, ?)");
  // Keep the last 50 saved versions of each key so a bad save can be rolled back.
  const stmtPrune = db.prepare(`
    DELETE FROM kv_history WHERE key = ? AND id NOT IN (
      SELECT id FROM kv_history WHERE key = ? ORDER BY id DESC LIMIT 50
    )
  `);
  const loginFailures = new Map();

  return {
    name: "sqlite",
    async get(key) {
      const row = stmtGet.get(key);
      return row ? { value: row.value, version: row.version, updated_at: row.updated_at } : null;
    },
    async put(key, value, role) {
      const now = new Date().toISOString();
      db.exec("BEGIN");
      try {
        stmtUpsert.run(key, value, now);
        stmtHistory.run(key, value, role, now);
        stmtPrune.run(key, key);
        db.exec("COMMIT");
      } catch (e) { db.exec("ROLLBACK"); throw e; }
      const row = stmtGet.get(key);
      return { version: row.version, updated_at: row.updated_at };
    },
    async all() {
      return stmtAll.all().map(r => ({ key: r.key, value: r.value, version: r.version, updated_at: r.updated_at }));
    },
    async loginFailureCount(ip) {
      const rec = loginFailures.get(ip);
      if (!rec || Date.now() - rec.since > 15 * 60 * 1000) { loginFailures.delete(ip); return 0; }
      return rec.count;
    },
    async recordLoginFailure(ip) {
      const rec = loginFailures.get(ip);
      if (rec && Date.now() - rec.since <= 15 * 60 * 1000) rec.count++;
      else loginFailures.set(ip, { count: 1, since: Date.now() });
    },
    async clearLoginFailures(ip) { loginFailures.delete(ip); },
    close() { db.close(); },
  };
};
