// Migration runner (design §4.4).
//
// Applies db/migrations/*.sql in order on its own connection with
// multipleStatements: true (the application pool keeps it false). Each
// version is recorded in schema_migrations only after the file succeeds, and
// the run stops at the first error. MySQL DDL commits implicitly, so there is
// no whole-file rollback: one logical change per file, using CREATE TABLE
// IF NOT EXISTS where possible. A server-side GET_LOCK (plan T10) makes two
// simultaneous runs impossible: the second one fails fast.
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
 * Name of the advisory lock that serializes migrations (plan T10).
 * GET_LOCK names belong to the whole server, so the database is part of the
 * name: migrating one database never blocks another. Capped at 64 chars,
 * the limit MySQL enforces on lock names.
 *
 * @param {string} dbName
 * @returns {string}
 */
export function migrationLockName(dbName) {
  return `api-to-do-qa:migrate:${dbName}`.slice(0, 64);
}

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
  const lockName = migrationLockName(db.name);
  let holdsLock = false;
  try {
    await connection.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`);
    await connection.query("SET SESSION time_zone = '+00:00'");

    // Plan T10: one migration at a time per database. Timeout 0 = fail fast
    // with a clear message instead of queueing behind another runner. The
    // lock is taken before any DDL, so a concurrent run changes nothing.
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    const acquired = lockRows[0]?.acquired;
    if (acquired === null || acquired === undefined) {
      throw new Error(`could not acquire the migration lock "${lockName}"`);
    }
    if (Number(acquired) !== 1) {
      throw new Error(
        `another migration is already running (lock "${lockName}" is held); retry when it finishes`
      );
    }
    holdsLock = true;

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
    if (holdsLock) {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => {});
    }
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
