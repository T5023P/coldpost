// Applies the PostgreSQL schema in server/migrations/pg/ to the database in
// DATABASE_URL, in filename order, each file in its own transaction.
// Applied files are recorded in public.schema_migrations so re-running is safe.
//
//   node scripts/migrate-pg.cjs            # apply pending migrations
//   node scripts/migrate-pg.cjs --status   # show what is applied
//
// Schema only: this does not copy rows out of the local SQLite database.

const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_DIR = path.join(ROOT, 'server', 'migrations', 'pg');

const DATABASE_URL = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set (postgresql://user:pass@host:5432/postgres)');
  process.exit(1);
}

async function main() {
  const statusOnly = process.argv.includes('--status');
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();

  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS public.schema_migrations (
         name text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const { rows: applied } = await client.query('SELECT name FROM public.schema_migrations');
    const done = new Set(applied.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATION_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('No .sql files in', MIGRATION_DIR);
      return;
    }

    if (statusOnly) {
      for (const f of files) console.log(done.has(f) ? 'applied ' : 'pending ', f);
      return;
    }

    for (const file of files) {
      if (done.has(file)) {
        console.log('skip    ', file, '(already applied)');
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO public.schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('applied ', file);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('FAILED  ', file);
        console.error('  code:   ', err.code || '-');
        console.error('  message:', err.message);
        if (err.position) console.error('  at char:', err.position);
        process.exitCode = 1;
        return;
      }
    }

    const { rows: tables } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const { rows: pending } = await client.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users'`,
    );
    console.log(`\npublic tables: ${tables[0].n}`);
    console.log(pending[0].n ? 'users table present' : 'WARNING: users table missing');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration run failed:', err);
  process.exit(1);
});
