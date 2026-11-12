import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const DB_FILE = process.env.DATABASE_FILE || path.join(DATA_DIR, 'mavyron.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SQL = await initSqlJs({ locateFile: () => wasmPath });

const existing = fs.existsSync(DB_FILE) ? new Uint8Array(fs.readFileSync(DB_FILE)) : null;
export const db = existing && existing.length
  ? new SQL.Database(existing)
  : new SQL.Database();

db.run('PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(here, '..', 'schema.sql'), 'utf8'));
const phase2 = path.join(here, '..', 'schema2.sql');
if (fs.existsSync(phase2)) db.exec(fs.readFileSync(phase2, 'utf8'));

function persist() {
  const bytes = Buffer.from(db.export());
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, DB_FILE);
}

function normalise(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    if (params && params.length) stmt.bind(params.map(normalise));
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function get(sql, params = []) {
  return all(sql, params)[0] ?? null;
}

export function scalar(sql, params = []) {
  const row = get(sql, params);
  if (!row) return null;
  return Object.values(row)[0];
}

let mutating = 0;
export function run(sql, params = []) {
  db.run(sql, params.map(normalise));
  const row = db.exec('SELECT last_insert_rowid() AS id, changes() AS changes')[0];
  const [id, changes] = row ? row.values[0] : [0, 0];
  if (mutating === 0) persist();
  return { id, changes };
}

/** Run a set of statements atomically. Throws and rolls back on any error. */
export function tx(fn) {
  db.run('BEGIN IMMEDIATE');
  mutating += 1;
  try {
    const result = fn();
    db.run('COMMIT');
    mutating -= 1;
    persist();
    return result;
  } catch (err) {
    mutating = Math.max(0, mutating - 1);
    try { db.run('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  }
}

export function insert(table, row) {
  const keys = Object.keys(row);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  run(sql, keys.map((k) => row[k]));
  return row.id;
}

export function update(table, id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  return run(sql, [...keys.map((k) => patch[k]), id]).changes;
}

export function findOne(table, id, businessId) {
  return businessId
    ? get(`SELECT * FROM ${table} WHERE id = ? AND business_id = ?`, [id, businessId])
    : get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
}

/** Tenant-scoped lookup used by every workspace route. */
export function tenantRow(table, id, businessId) {
  if (!id || !businessId) return null;
  return get(`SELECT * FROM ${table} WHERE id = ? AND business_id = ?`, [id, businessId]);
}

export function setting(key) {
  return scalar('SELECT value FROM platform_settings WHERE key = ?', [key]);
}

export function setSetting(key, value) {
  run(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, String(value), new Date().toISOString()]
  );
}

export { persist };
