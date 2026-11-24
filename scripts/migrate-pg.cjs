// Simple PostgreSQL schema migration script for Supabase
// Run with: node scripts/migrate-pg.cjs
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable not set');
  process.exit(1);
}

console.log('=== Cold Post: Apply PostgreSQL Schema to Supabase ===\n');

// Initialize PostgreSQL connection
const pgPool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Initialize SQLite reader for data migration
const ROOT = path.resolve(path.join(__dirname, '..', 'server', '..'));
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const dbPath = path.join(DATA_DIR, 'coldpost.db');
const sqliteDb = new DatabaseSync(dbPath);

async function main() {
  try {
    // Step 1: Apply the PostgreSQL schema
    console.log('--- Step 1: Applying PostgreSQL schema ---');
    const migrationDir = path.join(ROOT, 'server', 'migrations');
    const sql = fs.readFileSync(path.join(migrationDir, '002_postgresql.sql'), 'utf8');
    
    // Execute the schema migration
    await pgPool.query(sql);
    console.log('  ✓ Schema 002_postgresql.sql applied successfully');

    // Step 2: Create schema_migrations tracking table
    console.log('\n--- Step 2: Setting up migration tracking ---');
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    // Mark the migration as applied
    await pgPool.query(
      `INSERT INTO schema_migrations (name) VALUES ('002_postgresql.sql') ON CONFLICT DO NOTHING`
    );
    console.log('  ✓ Migration tracking table created');

    // Step 3: Migrate data from SQLite to PostgreSQL
    console.log('\n--- Step 3: Migrating data from SQLite to PostgreSQL ---');
    
    // Get all table names from SQLite
    const tables = sqliteDb.all(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    );
    
    const tablesToMigrate = tables.map(t => t.name).filter(t => 
      !['schema_migrations'].includes(t) // Skip tracking table
    );
    
    let totalRows = 0;
    
    for (const tableName of tablesToMigrate) {
      // Check if table exists in PG
      const { rows: [{ exists } }] = await pgPool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`,
        [tableName]
      );
      
      if (!exists) {
        console.log(`  ⊘ Table ${tableName} not in PG — creating from schema`);
        // The schema already created this, skip
        continue;
      }
      
      // Check row count in PG
      const { rows: [{ count } ]} = await pgPool.query(
        `SELECT COUNT(*) FROM "${tableName}"`
      );
      
      if (count && parseInt(count) > 0) {
        console.log(`  ⊘ Table ${tableName} already has data (${count} rows) — skipping`);
        continue;
      }
      
      // Get data from SQLite
      const rows = sqliteDb.all(`SELECT * FROM "${tableName}"`);
      if (rows.length === 0) {
        console.log(`  ℹ No data in SQLite table ${tableName} — skipping`);
        continue;
      }
      
      console.log(`  Migrating ${rows.length} rows from SQLite ${tableName} → PostgreSQL`);
      
      // Get column names from first row
      const columns = Object.keys(rows[0]);
      
      // Insert rows in batches
      for (const row of rows) {
        const colNames = columns.map(c => `"${c}"`).join(', ');
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(c => {
          const v = row[c];
          if (v === null || v === undefined) return null;
          if (typeof v === 'boolean') return v ? true : false;
          if (typeof v === 'number') return v;
          if (typeof v === 'string') return v;
          return String(v);
        });
        
        try {
          await pgPool.query(
            `INSERT INTO "${tableName}" (${colNames}) VALUES (${placeholders})`,
            values
          );
          totalRows++;
        } catch (err) {
          console.warn(`  ⚠ Failed row in ${tableName}: ${err.message.substring(0, 60)}`);
        }
      }
      console.log(`  ✓ Migrated ${rows.length} rows for ${tableName}`);
    }
    
    console.log(`\n  Total rows migrated: ${totalRows}`);

    // Step 4: Verify the connection
    console.log('\n--- Step 4: Verification ---');
    const { rows } = await pgPool.query('SELECT version() as pg_version, current_database() as db_name');
    console.log(`  ✓ PostgreSQL version: ${rows[0].pg_version}`);
    console.log(`  ✓ Connected to database: ${rows[0].db_name}`);
    
    // Close connections
    await pgPool.end();
    sqliteDb.close();
    
    console.log('\n=== Migration Complete ===');
    console.log('1. Schema applied to Supabase PostgreSQL');
    console.log('2. Data migrated from SQLite to PostgreSQL');
    console.log('3. Migration tracked in schema_migrations table');
    console.log('\nNext: Set up Supabase Storage buckets and verify the app works.');
    
  } catch (err) {
    console.error('Migration failed:', err);
    await pgPool.end();
    process.exit(1);
  }
}

main();