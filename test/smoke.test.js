import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';

// Smoke (T1 base, T8 rewiring): the QA endpoints keep their exact contract,
// now always behind authentication (design §6). Needs TEST_DB_* to create a
// session; skips without them (pattern L10, never falls back to DB_*).
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
      connectionLimit: 3,
    },
  };
}

const skipReason =
  !testConfig() && 'TEST_DB_HOST/NAME/USER not set (never falls back to DB_*)';

const APP_ORIGIN = 'http://localhost:4000';

let server;
let baseUrl;
let sessionCookie;

before(async () => {
  const config = testConfig();
  if (!config) return;
  await runMigrations(config.db);
  const pool = createPool(config);
  const app = createApp({
    config: { appOrigin: APP_ORIGIN, sessionDays: 7, nodeEnv: 'test' },
    pool,
  });
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  await pool.execute('DELETE FROM users');
  await userRepository.create(pool, {
    id: randomUUID(),
    email: 'smoke@example.com',
    fullName: 'Smoke User',
    role: 'qa_engineer',
    passwordHash: await hashPassword('smoke password 123'),
    mustChangePassword: false,
    isActive: true,
    createdBy: null,
  });
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: JSON.stringify({ email: 'smoke@example.com', password: 'smoke password 123' }),
  });
  assert.equal(login.status, 200);
  const raw = login.headers.get('set-cookie') ?? '';
  sessionCookie = /qa_session=([^;]*)/.exec(raw)[1];

  server.once('close', () => {
    pool.end();
  });
});

after(async () => {
  if (!server) return;
  server.close();
  await once(server, 'close');
});

test('GET / without a session redirects to the login page', { skip: skipReason }, async () => {
  // redirect: 'manual' to assert the 302 itself (pattern from T6).
  const res = await fetch(`${baseUrl}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login.html');
});

test('GET / serves the index page with a session', { skip: skipReason }, async () => {
  const res = await fetch(`${baseUrl}/`, {
    headers: { Cookie: `qa_session=${sessionCookie}` },
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<html/i);
});

test('POST /api/full-analysis/run without url responds 400 as before', { skip: skipReason }, async () => {
  const res = await fetch(`${baseUrl}/api/full-analysis/run`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Origin: APP_ORIGIN,
      Cookie: `qa_session=${sessionCookie}`,
    },
    body: '{}',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Missing url' });
});

test('POST /api/cancel responds with the cancellation summary', { skip: skipReason }, async () => {
  const res = await fetch(`${baseUrl}/api/cancel`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN, Cookie: `qa_session=${sessionCookie}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cancelled, true);
  assert.equal(typeof body.browsersClosed, 'number');
});

test('POST /api/cancel without Origin is rejected by the global origin check', { skip: skipReason }, async () => {
  const res = await fetch(`${baseUrl}/api/cancel`, {
    method: 'POST',
    headers: { Cookie: `qa_session=${sessionCookie}` },
  });
  assert.equal(res.status, 403);
  assert.deepEqual(await res.json(), { error: 'invalid_origin' });
});

test('POST /api/cancel without a session is unauthenticated', { skip: skipReason }, async () => {
  const res = await fetch(`${baseUrl}/api/cancel`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN },
  });
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'unauthenticated');
});
