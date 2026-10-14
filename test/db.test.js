import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPool } from '../src/db/pool.js';

// Integration test against a real MySQL/MariaDB (design §10).
//
// Deliberately reads ONLY TEST_DB_* and never DB_*: integration tests will
// truncate/drop data (from T3 on), so they must never touch the development
// database that DB_* points at. Without TEST_DB_* the test skips.
const TEST_REQUIRED = ['TEST_DB_HOST', 'TEST_DB_NAME', 'TEST_DB_USER'];

function testConfig() {
  const missing = TEST_REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) return null;
  return {
    db: {
      host: process.env.TEST_DB_HOST,
      port: Number(process.env.TEST_DB_PORT ?? 3306),
      name: process.env.TEST_DB_NAME,
      user: process.env.TEST_DB_USER,
      password: process.env.TEST_DB_PASSWORD ?? '',
      ssl: false,
      connectionLimit: 2,
    },
  };
}

async function serverReachable(config) {
  try {
    const socket = new net.Socket();
    await new Promise((resolve, reject) => {
      socket.setTimeout(1000);
      socket.once('connect', resolve);
      socket.once('timeout', reject);
      socket.once('error', reject);
      socket.connect(config.db.port, config.db.host);
    });
    socket.destroy();
    return true;
  } catch {
    return false;
  }
}

test('pool connects and runs SELECT 1 in strict UTC mode', { skip: !testConfig() && 'TEST_DB_HOST/NAME/USER not set (never falls back to DB_*)' }, async (t) => {
  const config = testConfig();
  if (!(await serverReachable(config))) {
    t.skip(`no MySQL/MariaDB answering on ${config.db.host}:${config.db.port}`);
    return;
  }

  const pool = createPool(config);
  try {
    const [[row]] = await pool.query('SELECT 1 AS ok');
    assert.equal(row.ok, 1);

    const [[mode]] = await pool.query("SELECT @@session.sql_mode AS mode");
    assert.match(mode.mode, /STRICT_ALL_TABLES/);

    const [[tz]] = await pool.query("SELECT @@session.time_zone AS tz");
    assert.equal(tz.tz, '+00:00');
  } finally {
    await pool.end();
  }
});
