// Migration runner (design §4.4).
//
// Applies db/migrations/*.sql in order on its own connection with
// multipleStatements: true (the application pool keeps it false). Each
// version is recorded in schema_migrations only after the file succeeds, and
// the run stops at the first error. MySQL DDL commits implicitly, so there is
// no whole-file rollback: one logical change per file, using CREATE TABLE
// IF NOT EXISTS where possible.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config/env.js';

// Same session strict mode and UTC as src/db/pool.js (design §4).
const STRICT_SQL_MODE =
  "STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";

const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'db',
  'migrations'
);

const CREATE_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    VARCHAR(100) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

/**
 * Applies every pending .sql file in `migrationsDir`, in file-name order.
 *
 * @param {{host: string, port: number, name: string, user: string, password: string, ssl?: boolean}} db
 * @param {{migrationsDir?: string, logger?: {log?: Function}}} [options]
 * @returns {Promise<{applied: string[], skipped: string[]}>} versions, without the .sql extension
 */
export async function runMigrations(db, { migrationsDir = DEFAULT_MIGRATIONS_DIR, logger = console } = {}) {
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const connection = await mysql.createConnection({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.name,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
    ssl: db.ssl ? {} : undefined,
  });

  const applied = [];
  const skipped = [];
  try {
    await connection.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`);
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query(CREATE_TRACKING_TABLE);

    const [rows] = await connection.query('SELECT version FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((row) => row.version));

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (alreadyApplied.has(version)) {
        skipped.push(version);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      try {
        await connection.query(sql);
      } catch (error) {
        throw new Error(`migration ${version} failed: ${error.message}`, { cause: error });
      }
      await connection.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP(3))',
        [version]
      );
      applied.push(version);
      logger.log?.(`[migrate] applied ${version}`);
    }
  } finally {
    await connection.end();
  }

  return { applied, skipped };
}

async function main() {
  const config = loadConfig();
  const db = {
    host: config.db.host,
    port: config.db.port,
    name: config.db.name,
    // Design §5.6: migrations run with the migration user when configured;
    // falls back to the app user for simple local setups.
    user: process.env.MIGRATE_DB_USER ?? config.db.user,
    password: process.env.MIGRATE_DB_PASSWORD ?? config.db.password,
    ssl: config.db.ssl,
  };

  const { applied, skipped } = await runMigrations(db);
  console.log(
    applied.length === 0
      ? `[migrate] nothing to do, ${skipped.length} migration(s) already applied.`
      : `[migrate] applied ${applied.length} migration(s): ${applied.join(', ')}.`
  );
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`[migrate] ${error.message}`);
    process.exitCode = 1;
  });
}
