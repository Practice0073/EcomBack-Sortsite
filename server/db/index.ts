import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from '../config.js';

export const db = new DatabaseSync(config.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 30000;');
db.exec(fs.readFileSync(path.join(import.meta.dirname, 'schema.sql'), 'utf8'));

/** Additive migrations for databases created by earlier builds (CREATE TABLE IF NOT EXISTS won't add columns). */
function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
ensureColumn('scans', 'links_total', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('scans', 'links_done', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('scans', 'links_started_at', 'TEXT');
ensureColumn('api_tokens', 'app_id', 'INTEGER REFERENCES oauth_apps(id) ON DELETE CASCADE');
ensureColumn('api_tokens', 'scope', "TEXT NOT NULL DEFAULT 'full'");
ensureColumn('api_tokens', 'code_hash', 'TEXT'); // OAuth code a token was issued from (replay → revoke exactly that token)

type Params = Record<string, SQLInputValue> | SQLInputValue[];

const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>();
function stmt(sql: string) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

const bind = (params?: Params): SQLInputValue[] | [Record<string, SQLInputValue>] =>
  params === undefined ? [] : Array.isArray(params) ? params : [params];

/** Typed query helpers. Row types are asserted by the caller — keep SQL and interfaces adjacent. */
export const q = {
  get<T>(sql: string, params?: Params): T | undefined {
    return stmt(sql).get(...(bind(params) as SQLInputValue[])) as T | undefined;
  },
  all<T>(sql: string, params?: Params): T[] {
    return stmt(sql).all(...(bind(params) as SQLInputValue[])) as T[];
  },
  run(sql: string, params?: Params): { changes: number; lastId: number } {
    const r = stmt(sql).run(...(bind(params) as SQLInputValue[]));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  },
  /** Scalar helper for COUNT/SUM. */
  value<T extends number | string | null>(sql: string, params?: Params): T {
    const row = stmt(sql).get(...(bind(params) as SQLInputValue[])) as Record<string, unknown> | undefined;
    return (row ? Object.values(row)[0] : null) as T;
  },
};

let depth = 0;
/** Re-entrant transaction (nested calls join the outer transaction). */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

export const nowIso = () => new Date().toISOString();
