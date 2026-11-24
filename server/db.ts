import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');

export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const dbPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(DATA_DIR, 'coldpost.db');

export const DB_PATH = dbPath;

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode = WAL');

db.exec('PRAGMA foreign_keys = ON');

db.exec('PRAGMA busy_timeout = 5000');

export type Row = Record<string, any>;

function normalize(value: any) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function all<T = Row>(sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params.map(normalize)) as T[];
}

export function get<T = Row>(sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params.map(normalize)) as T | undefined;
}

export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params.map(normalize));
}

export function insert(table: string, data: Record<string, any>): number {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const result = run(sql, ...keys.map((k) => data[k]));
  return Number(result.lastInsertRowid);
}

export function update(table: string, id: number, data: Record<string, any>) {
  const keys = Object.keys(data).filter((k) => k !== 'id');
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  run(sql, ...keys.map((k) => data[k]), id);
}

let txDepth = 0;

/** Runs fn atomically. Nested calls use SAVEPOINTs so helpers that manage their own transaction (stock movements, for example) compose inside a larger one. */

export function tx<T>(fn: () => T): T {
  const isRoot = txDepth === 0;
  const savepoint = `cp_sp_${txDepth}`;
  db.exec(isRoot ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  txDepth += 1;
  try {
    const result = fn();
    txDepth -= 1;
    db.exec(isRoot ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    txDepth -= 1;
    try {
      if (isRoot) db.exec('ROLLBACK');
      else db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const dir = path.join(here, 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(all<{ name: string }>('SELECT name FROM schema_migrations').map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    tx(() => {
      db.exec(sql);
      run('INSERT INTO schema_migrations (name) VALUES (?)', file);
    });
    console.log(`[db] applied migration ${file}`);
  }
}

export function jsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}