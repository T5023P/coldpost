import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, '..');

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
const pool = dbUrl ? new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } }) : null;
export const USE_PG = !!dbUrl;
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const DB_PATH = undefined;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export { pool };

export async function query<T = any>(sql: string, ...params: any[]): Promise<T[]> {
  if (!pool) throw new Error('PostgreSQL pool not configured — set DATA_URL');
  const client = await pool.connect();
  try {
    const { rows } = await client.query(sql, params.length ? params : undefined);
    return rows as any as T[];
  } finally {
    client.release();
  }
}

export async function exec(sql: string, ...params: any[]): Promise<void> {
  if (!pool) throw new Error('PostgreSQL pool not configured — set DATA_URL');
  const client = await pool.connect();
  try {
    await client.query(sql, params.length ? params : undefined);
  } finally {
    client.release();
  }
}

export async function get<T = any>(sql: string, ...params: any[]): Promise<T | undefined> {
  const rows = await query<T>(sql, ...params);
  return rows.length ? rows[0] : undefined;
}

let txDepth = 0;

export async function tx<T>(fn: () => Promise<T>): Promise<T> {
  const isRoot = txDepth === 0;
  const savepoint = `cp_sp_${txDepth}`;
  if (!isRoot) await pool!.query(`SAVEPOINT ${savepoint}`);
  txDepth += 1;
  try {
    const result = await fn();
    txDepth -= 1;
    if (isRoot) await pool!.query('COMMIT');
    else await pool!.query(`RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    txDepth -= 1;
    try { await pool!.query(`ROLLBACK TO ${savepoint}`); } catch { /* ignore */ }
    try { await pool!.query(`RELEASE ${savepoint}`); } catch { /* ignore */ }
    throw error;
  }
}

export function normalize(value: any) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export function all<T = any>(sql: string, ...params: any[]): T[] {
  return query(sql, ...params) as any as T[];
}

export function run(sql: string, ...params: any[]): any {
  return query(sql, ...params);
}

export async function insert(table: string, data: Record<string, any>): Promise<number> {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const result: any[] = await query(sql, ...keys.map((k) => data[k]));
  return Number(result[0] ?? 0);
}

export function update(table: string, id: number, data: Record<string, any>) {
  const keys = Object.keys(data).filter((k) => k !== 'id');
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const vals = keys.map((k) => data[k]);
  query(`UPDATE ${table} SET ${sets} WHERE id = ?`, ...vals, id);
}

export function migrate() {
  if (!pool) {
    console.warn('[db.pg] Migration skipped — no PostgreSQL pool configured');
    return;
  }
  pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  );
  const dir = path.join(here, 'migrations', 'pg');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  return new Promise<void>((resolve, reject) => {
    const next = () => {
      if (files.length === 0) return resolve();
      const file = files.shift();
      if (!file) return next();
      pool.query(`SELECT 1 FROM schema_migrations WHERE name = $1`, [file]).then(([[r]]: any) => {
        if (r) return next();
        const sql = fs.readFileSync(path.join(dir, file), 'utf8');
        pool.query(sql).then(() => {
          pool.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
          console.log(`[db.pg] applied migration ${file}`);
          next();
        }).catch(reject);
      }).catch(reject);
    };
    next();
  });
}

export function nowIso() {
  return new Date().toISOString();
}

export async function operatingMode(): Promise<'manual' | 'api'> {
  if (!pool) return 'manual';
  const row = await get(`SELECT value FROM settings WHERE key = 'operatingMode'`);
  if (!row) return 'manual';
  try {
    const parsed = JSON.parse(row.value);
    return parsed === 'api' ? ('api' as const) : ('manual' as const);
  } catch {
    return 'manual';
  }
}

export const defaultSettings = {
  business: {
    name: 'Cold Post',
    tagline: 'Physical campaigns, gifting & fulfilment',
    email: '',
    phone: '',
    address: '',
    gstin: '',
    website: '',
  },
  currency: { code: 'INR', symbol: '₹', locale: 'en-IN' },
  tax: {
    label: 'GST',
    defaultRatePct: 18,
    inclusive: false,
    rates: [
      { name: 'GST 5%', ratePct: 5 },
      { name: 'GST 12%', ratePct: 12 },
      { name: 'GST 18%', ratePct: 18 },
      { name: 'GST 28%', ratePct: 28 },
    ],
  },
  numbering: {
    orderPrefix: 'CP',
    quotationPrefix: 'QT',
    purchasePrefix: 'PO',
    includeYear: true,
    padding: 4,
  },
  costing: {
    assemblyLabourPerPackagePaise: 12000,
    qcLabourPerPackagePaise: 3000,
    paymentFeePct: 2,
    defaultShippingPerPackagePaise: 15000,
    packagingBufferPct: 5,
  },
  qcChecklist: [
    'Correct recipient name',
    'Correct personalised letter',
    'Correct QR code or destination',
    'All required products included',
    'Products free from visible defects',
    'Stickers and labels applied correctly',
    'Packaging arranged correctly',
    'Protective filler included',
    'Tamper-evident seal applied',
    'Final package photographs uploaded',
    'Shipping label details checked',
  ],
  messaging: {
    defaultCountryCode: '+91',
    signature: '— Team Cold Post',
  },
  procurement: {
    advanceRequirementPct: 50,
  },
  operatingMode: 'manual' as 'manual' | 'api',
  notifications: {
    feedbackDelayDays: 3,
    lowStockAlerts: true,
  },
}

export async function getSetting(key: string): Promise<any> {
  if (!pool) return defaultSettings[key as keyof typeof defaultSettings];
  const row = await get(`SELECT value FROM settings WHERE key = $1`, [key]);
  if (!row) return defaultSettings[key as keyof typeof defaultSettings];
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !Array.isArray(defaultSettings[key as keyof typeof defaultSettings])) {
      return Object.assign({}, defaultSettings[key as keyof typeof defaultSettings], parsed);
    }
    return parsed;
  } catch {
    return defaultSettings[key as keyof typeof defaultSettings];
  }
}

export async function setSetting(key: string, value: unknown, userId?: number | null): Promise<void> {
  if (!pool) return;
  await query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, NOW(), $3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = NOW(), updated_by = excluded.updated_by`,
    [key, JSON.stringify(value), userId ?? null]
  );
}