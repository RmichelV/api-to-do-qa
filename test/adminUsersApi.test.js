import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';
import { USER_ROLES } from '../src/services/adminUserService.js';

// PLAN F4 — the weekly QA Shadow role (D1, D6): the admin users API accepts
// `qa_shadow` on create and on PATCH, any number of users may hold it at the
// same time (D9), and the two role-table guards of design §7.2 (last_admin,
// self_change) still answer 409 with the new role around.
// Real database and real HTTP server.
// Only TEST_DB_* — never DB_* (L10); skips without them.
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
const TEMP_PASSWORD = 'temporary password 123';
const ADMIN_EMAIL = 'f4-admin@example.com';
const ADMIN_PASSWORD = 'f4 admin password 1';

async function startApp(t) {
  const config = testConfig();
  await runMigrations(config.db);
  const pool = createPool(config);
  const app = createApp({
    config: { appOrigin: APP_ORIGIN, sessionDays: 7, nodeEnv: 'test' },
    pool,
  });
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
    // qa_records.owner_id / reviewer_id reference users (RESTRICT): wipe the
    // children first so the next test file starts clean (FK-safe order).
    await pool.execute('DELETE FROM user_sessions');
    await pool.execute('DELETE FROM login_attempts');
    await pool.execute('DELETE FROM qa_record_bugs');
    await pool.execute('DELETE FROM qa_records');
    await pool.execute('DELETE FROM users WHERE created_by IS NOT NULL');
    await pool.execute('DELETE FROM users');
    await pool.end();
  });
  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  await pool.execute('DELETE FROM qa_record_bugs');
  await pool.execute('DELETE FROM qa_records');
  await pool.execute('DELETE FROM users WHERE created_by IS NOT NULL');
  await pool.execute('DELETE FROM users');
  await seedUser(pool, {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    fullName: 'F4 Admin',
    role: 'admin',
  });
  return { base: `http://127.0.0.1:${server.address().port}`, pool };
}

async function seedUser(
  pool,
  { email, password, fullName = 'Seed User', role = 'qa_engineer' } = {}
) {
  const id = randomUUID();
  await userRepository.create(pool, {
    id,
    email,
    fullName,
    role,
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
    isActive: true,
    createdBy: null,
  });
  return id;
}

function request(base, method, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Origin: APP_ORIGIN,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function sessionCookie(response) {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = /qa_session=([^;]*)/.exec(raw);
  return match ? match[1] : null;
}

function cookieHeader(token) {
  return { Cookie: `qa_session=${token}` };
}

async function loginAs(base, email, password) {
  const response = await request(base, 'POST', '/api/auth/login', { email, password });
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

async function roleOf(pool, id) {
  const [[row]] = await pool.execute('SELECT role FROM users WHERE id = ?', [id]);
  return row?.role;
}

test('USER_ROLES and the users API accept qa_shadow (D1, D6)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  assert.deepEqual([...USER_ROLES], ['admin', 'qa_engineer', 'qa_shadow']);

  // Creating a user straight with the role (D6: the Admin assigns it).
  const created = await request(
    base,
    'POST',
    '/api/admin/users',
    {
      email: 'f4-shadow@example.com',
      fullName: 'F4 Shadow',
      role: 'qa_shadow',
      temporaryPassword: TEMP_PASSWORD,
    },
    cookieHeader(cookie)
  );
  assert.equal(created.status, 201);
  assert.equal((await created.json()).user.role, 'qa_shadow');

  // The screen's control: engineer → qa_shadow → engineer again (D1: the
  // role is weekly, never fixed).
  const engineerId = await seedUser(pool, {
    email: 'f4-engineer@example.com',
    password: 'f4 engineer password 1',
  });
  const promoted = await request(
    base,
    'PATCH',
    `/api/admin/users/${engineerId}`,
    { role: 'qa_shadow' },
    cookieHeader(cookie)
  );
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).user.role, 'qa_shadow');
  assert.equal(await roleOf(pool, engineerId), 'qa_shadow');

  const demoted = await request(
    base,
    'PATCH',
    `/api/admin/users/${engineerId}`,
    { role: 'qa_engineer' },
    cookieHeader(cookie)
  );
  assert.equal(demoted.status, 200);
  assert.equal((await demoted.json()).user.role, 'qa_engineer');
  assert.equal(await roleOf(pool, engineerId), 'qa_engineer');

  // The schema and the validator stay in sync: anything else is still 400.
  const invalid = await request(
    base,
    'PATCH',
    `/api/admin/users/${engineerId}`,
    { role: 'superuser' },
    cookieHeader(cookie)
  );
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).message, /role/);
});

test('several users can hold qa_shadow at the same time (D9)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const firstId = await seedUser(pool, {
    email: 'f4-shadow-1@example.com',
    password: 'f4 shadow password 1',
  });
  const secondId = await seedUser(pool, {
    email: 'f4-shadow-2@example.com',
    password: 'f4 shadow password 2',
  });

  for (const id of [firstId, secondId]) {
    const response = await request(
      base,
      'PATCH',
      `/api/admin/users/${id}`,
      { role: 'qa_shadow' },
      cookieHeader(cookie)
    );
    assert.equal(response.status, 200);
  }

  const list = await request(base, 'GET', '/api/admin/users', undefined, cookieHeader(cookie));
  assert.equal(list.status, 200);
  const shadows = (await list.json()).users.filter((user) => user.role === 'qa_shadow');
  assert.deepEqual(
    shadows.map((user) => user.id).sort(),
    [firstId, secondId].sort(),
    'both users must still be qa_shadow at once'
  );
  assert.equal(await roleOf(pool, firstId), 'qa_shadow');
  assert.equal(await roleOf(pool, secondId), 'qa_shadow');
});

test('the admin guards still hold now that qa_shadow exists', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const selfId = await userIdByEmail(pool, ADMIN_EMAIL);
  const peerId = await seedUser(pool, {
    email: 'f4-peer@example.com',
    password: 'f4 peer password 1',
    fullName: 'F4 Peer Admin',
    role: 'admin',
  });
  // A Shadow next to the admins: none of the guards may start treating it
  // as an admin or skipping the checks.
  const shadowId = await seedUser(pool, {
    email: 'f4-guard-shadow@example.com',
    password: 'f4 guard password 1',
    role: 'qa_shadow',
  });
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Two active admins now, so the only thing blocking a self-demotion is
  // self_change — last_admin must not be the answer.
  const demoteSelf = await request(
    base,
    'PATCH',
    `/api/admin/users/${selfId}`,
    { role: 'qa_engineer' },
    cookieHeader(cookie)
  );
  assert.equal(demoteSelf.status, 409);
  assert.equal((await demoteSelf.json()).error, 'self_change');

  const deactivateSelf = await request(
    base,
    'PATCH',
    `/api/admin/users/${selfId}`,
    { isActive: false },
    cookieHeader(cookie)
  );
  assert.equal(deactivateSelf.status, 409);
  assert.equal((await deactivateSelf.json()).error, 'self_change');

  // Demoting the peer admin leaves one active admin: allowed.
  const demotePeer = await request(
    base,
    'PATCH',
    `/api/admin/users/${peerId}`,
    { role: 'qa_shadow' },
    cookieHeader(cookie)
  );
  assert.equal(demotePeer.status, 200);
  assert.equal(await roleOf(pool, peerId), 'qa_shadow');

  // Sole admin again: last_admin answers for both demote and deactivate.
  const demoteSole = await request(
    base,
    'PATCH',
    `/api/admin/users/${selfId}`,
    { role: 'qa_engineer' },
    cookieHeader(cookie)
  );
  assert.equal(demoteSole.status, 409);
  assert.equal((await demoteSole.json()).error, 'last_admin');

  const deactivateSole = await request(
    base,
    'PATCH',
    `/api/admin/users/${selfId}`,
    { isActive: false },
    cookieHeader(cookie)
  );
  assert.equal(deactivateSole.status, 409);
  assert.equal((await deactivateSole.json()).error, 'last_admin');

  // The guard left the account untouched.
  assert.equal(await roleOf(pool, selfId), 'admin');

  // A Shadow is not an admin: the whole admin API stays closed to it.
  const shadowCookie = await loginAs(base, 'f4-guard-shadow@example.com', 'f4 guard password 1');
  for (const [method, path, body] of [
    ['GET', '/api/admin/users', undefined],
    ['PATCH', `/api/admin/users/${shadowId}`, { role: 'qa_engineer' }],
    ['POST', '/api/admin/users', { email: 'x@example.com', fullName: 'X', role: 'qa_engineer', temporaryPassword: TEMP_PASSWORD }],
  ]) {
    const response = await request(base, method, path, body, cookieHeader(shadowCookie));
    assert.equal(response.status, 403, `${method} ${path} as qa_shadow`);
    assert.equal((await response.json()).error, 'forbidden', `${method} ${path}`);
  }
  assert.equal(await roleOf(pool, shadowId), 'qa_shadow', 'the refused PATCH changed nothing');
});

async function userIdByEmail(pool, email) {
  const [[row]] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  return row.id;
}
