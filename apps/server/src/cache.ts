import { createRequire } from "node:module";
import type { Scorecard } from "@scorecard/schema";

const require = createRequire(import.meta.url);

export interface CacheEntry {
  scorecard: Scorecard;
  storedAt: number;
}

export interface ScorecardCache {
  get(key: string): CacheEntry | null;
  set(key: string, scorecard: Scorecard): void;
}

/**
 * SQLite-backed cache. Falls back to an in-memory Map if the native module or
 * the database file can't be initialized, so the server always boots.
 */
export function createCache(opts: { dbPath?: string; ttlMs?: number } = {}): ScorecardCache {
  const ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
  try {
    // Lazy import so a missing native build degrades gracefully.
    const Database = require("better-sqlite3");
    const db = new Database(opts.dbPath ?? "scorecard-cache.sqlite");
    db.pragma("journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS scorecards (
         key TEXT PRIMARY KEY,
         json TEXT NOT NULL,
         stored_at INTEGER NOT NULL
       )`,
    );
    const getStmt = db.prepare("SELECT json, stored_at FROM scorecards WHERE key = ?");
    const setStmt = db.prepare(
      "INSERT INTO scorecards (key, json, stored_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET json = excluded.json, stored_at = excluded.stored_at",
    );
    return {
      get(key) {
        const row = getStmt.get(key) as { json: string; stored_at: number } | undefined;
        if (!row) return null;
        if (Date.now() - row.stored_at > ttlMs) return null;
        return { scorecard: JSON.parse(row.json) as Scorecard, storedAt: row.stored_at };
      },
      set(key, scorecard) {
        setStmt.run(key, JSON.stringify(scorecard), Date.now());
      },
    };
  } catch (err) {
    console.warn(
      `[cache] SQLite unavailable (${(err as Error).message}); using in-memory cache.`,
    );
    const mem = new Map<string, CacheEntry>();
    return {
      get(key) {
        const e = mem.get(key);
        if (!e) return null;
        if (Date.now() - e.storedAt > ttlMs) return null;
        return e;
      },
      set(key, scorecard) {
        mem.set(key, { scorecard, storedAt: Date.now() });
      },
    };
  }
}
