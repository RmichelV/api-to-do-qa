import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { runMigrations } from '../scripts/migrate.js';

// Integration test against a real MySQL/MariaDB (design §10, §4.4).
//
// Reads ONLY TEST_DB_* and never DB_*: it drops and recreates the auth
// tables, so it must never touch the development database (rule from L10,
// same as test/db.test.js). Without TEST_DB_* the test skips.
const TEST_REQUIRED = ['TEST_DB_HOST', 'TEST_DB_NAME', 'TEST_DB_USER'];

function testConfig() {
  const missing = TEST_REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) return null;
  return {
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT ?? 3306),
    name: process.env.TEST_DB_NAME,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD ?? '',
  };
}

const skipReason =
  !testConfig() && 'TEST_DB_HOST/NAME/USER not set (never falls back to DB_*)';

async function connect(config) {
  return mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.name,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
  });
}

async function dropAuthSchema(conn) {
  await conn.query('DROP TABLE IF EXISTS login_attempts');
  await conn.query('DROP TABLE IF EXISTS user_sessions');
  await conn.query('DROP TABLE IF EXISTS users');
  await conn.query('DROP TABLE IF EXISTS schema_migrations');
}

async function tableExists(conn, schema, table) {
  const [[row]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables ' +
      'WHERE table_schema = ? AND table_name = ?',
    [schema, table]
  );
  return Number(row.n) === 1;
}

test('applies pending migrations in order and records versions', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const conn = await connect(config);
  t.after(() => conn.end());
  await dropAuthSchema(conn);

  const result = await runMigrations(config);

  assert.deepEqual(result.applied, [
    '001_create_users',
    '002_create_user_sessions',
    '003_create_login_attempts',
  ]);
  assert.deepEqual(result.skipped, []);

  const [versions] = await conn.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(versions.map((row) => row.version), [...result.applied].sort());

  for (const table of ['users', 'user_sessions', 'login_attempts']) {
    assert.equal(await tableExists(conn, config.name, table), true, `table ${table} should exist`);
  }

  // S7: portable charset/collation on every auth table.
  for (const table of ['users', 'user_sessions', 'login_attempts']) {
    const [[row]] = await conn.query(
      'SELECT table_collation FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [config.name, table]
    );
    assert.equal(row.table_collation, 'utf8mb4_unicode_ci', `${table} collation`);
  }
});

test('second run is a no-op (idempotent)', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const conn = await connect(config);
  t.after(() => conn.end());
  await dropAuthSchema(conn);

  const first = await runMigrations(config);
  assert.equal(first.applied.length, 3);

  const second = await runMigrations(config);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(second.skipped.sort(), [
    '001_create_users',
    '002_create_user_sessions',
    '003_create_login_attempts',
  ]);

  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM schema_migrations');
  assert.equal(Number(row.n), 3);
});

test('stops at the first failing file and does not record its version', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const conn = await connect(config);
  t.after(async () => {
    await conn.query('DROP TABLE IF EXISTS t_probe_ok');
    await conn.query('DROP TABLE IF EXISTS schema_migrations');
    await conn.end();
  });
  await dropAuthSchema(conn);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(dir, '001_ok.sql'),
    'CREATE TABLE t_probe_ok (id INT NOT NULL PRIMARY KEY);\n'
  );
  fs.writeFileSync(path.join(dir, '002_bad.sql'), 'CREATE TABLE (INVALID SQL;\n');

  await assert.rejects(() => runMigrations(config, { migrationsDir: dir }), /002_bad/);

  // Version recorded only after the file succeeds (design §4.4).
  const [versions] = await conn.query('SELECT version FROM schema_migrations ORDER BY version');
  assert.deepEqual(versions.map((row) => row.version), ['001_ok']);
  assert.equal(await tableExists(conn, config.name, 't_probe_ok'), true);
  assert.equal(await tableExists(conn, config.name, 't_probe_bad'), false);
});
