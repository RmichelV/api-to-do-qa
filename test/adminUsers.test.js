import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';

// Integration tests for the admin users API (design §7.2, plan T9):
// requireRole('admin') at §6 step 9 plus GET/POST/PATCH /api/admin/users and
// POST /api/admin/users/:id/reset-password, with the self-change and
// last-admin guards. Real database and real HTTP server.
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
    // Users created through the API carry created_by; wipe children first so
    // the next test file starts from an empty table (FK-safe order).
    await pool.execute('DELETE FROM user_sessions');
    await pool.execute('DELETE FROM users WHERE created_by IS NOT NULL');
    await pool.execute('DELETE FROM users');
    await pool.end();
  });
  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  // Users created through the API carry created_by → FK-safe order.
  await pool.execute('DELETE FROM users WHERE created_by IS NOT NULL');
  await pool.execute('DELETE FROM users');
  return { base: `http://127.0.0.1:${server.address().port}`, pool };
}

async function seedUser(
  pool,
  { email, password, fullName = 'Seed User', role = 'qa_engineer', isActive = true, mustChangePassword = false } = {}
) {
  const id = randomUUID();
  await userRepository.create(pool, {
    id,
    email,
    fullName,
    role,
    passwordHash: await hashPassword(password),
    mustChangePassword,
    isActive,
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

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'admin password 123';

async function seedAdmin(pool, email = ADMIN_EMAIL) {
  return seedUser(pool, {
    email,
    password: ADMIN_PASSWORD,
    fullName: 'Admin User',
    role: 'admin',
  });
}

test('admin API requires a session and the admin role', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedAdmin(pool);
  const qaId = await seedUser(pool, { email: 'qa@example.com', password: 'qa password 12345' });
  const qaCookie = await loginAs(base, 'qa@example.com', 'qa password 12345');

  const calls = [
    ['GET', '/api/admin/users', undefined],
    ['POST', '/api/admin/users', { email: 'x@example.com', fullName: 'X', role: 'qa_engineer', temporaryPassword: TEMP_PASSWORD }],
    ['PATCH', `/api/admin/users/${qaId}`, { fullName: 'Renamed' }],
    ['POST', `/api/admin/users/${qaId}/reset-password`, { temporaryPassword: TEMP_PASSWORD }],
  ];

  for (const [method, path, body] of calls) {
    const anonymous = await request(base, method, path, body);
    assert.equal(anonymous.status, 401, `${method} ${path} without a session`);
    assert.equal((await anonymous.json()).error, 'unauthenticated', `${method} ${path}`);

    const asQa = await request(base, method, path, body, cookieHeader(qaCookie));
    assert.equal(asQa.status, 403, `${method} ${path} as qa_engineer`);
    assert.equal((await asQa.json()).error, 'forbidden', `${method} ${path}`);
  }
});

test('GET /api/admin/users lists users and never exposes password_hash', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminId = await seedAdmin(pool);
  await seedUser(pool, { email: 'qa@example.com', password: 'qa password 12345' });
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  const response = await request(base, 'GET', '/api/admin/users', undefined, cookieHeader(cookie));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.users.length, 2);

  const raw = JSON.stringify(body);
  assert.ok(!raw.includes('password_hash'), 'password_hash must never leave the server');
  assert.ok(!raw.includes('scrypt$'), 'the stored hash must never leave the server');

  const admin = body.users.find((user) => user.id === adminId);
  assert.equal(admin.email, ADMIN_EMAIL);
  assert.equal(admin.fullName, 'Admin User');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.isActive, true);
  assert.equal(admin.mustChangePassword, false);
  const qa = body.users.find((user) => user.email === 'qa@example.com');
  assert.equal(qa.role, 'qa_engineer');
});

test('POST /api/admin/users creates a user with a temporary password and forces the change', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminId = await seedAdmin(pool);
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  const response = await request(
    base,
    'POST',
    '/api/admin/users',
    {
      email: '  New.User@Example.COM ',
      fullName: 'New User',
      role: 'qa_engineer',
      temporaryPassword: TEMP_PASSWORD,
    },
    cookieHeader(cookie)
  );
  assert.equal(response.status, 201);
  const { user } = await response.json();
  assert.equal(user.email, 'new.user@example.com');
  assert.equal(user.fullName, 'New User');
  assert.equal(user.role, 'qa_engineer');
  assert.equal(user.isActive, true);
  assert.equal(user.mustChangePassword, true);
  assert.ok(!('password_hash' in user), 'password_hash must never leave the server');

  const [[row]] = await pool.execute(
    'SELECT must_change_password, is_active, created_by FROM users WHERE id = ?',
    [user.id]
  );
  assert.equal(row.must_change_password, 1);
  assert.equal(row.is_active, 1);
  assert.equal(row.created_by, adminId);

  // The temporary password works and the forced change flag comes back.
  const login = await request(base, 'POST', '/api/auth/login', {
    email: 'new.user@example.com',
    password: TEMP_PASSWORD,
  });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.mustChangePassword, true);
});

test('POST /api/admin/users validates the payload', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedAdmin(pool);
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const valid = {
    email: 'someone@example.com',
    fullName: 'Someone',
    role: 'qa_engineer',
    temporaryPassword: TEMP_PASSWORD,
  };

  const missingEmail = await request(base, 'POST', '/api/admin/users', { ...valid, email: '' }, cookieHeader(cookie));
  assert.equal(missingEmail.status, 400);
  assert.equal((await missingEmail.json()).error, 'validation_error');

  const badRole = await request(base, 'POST', '/api/admin/users', { ...valid, role: 'superuser' }, cookieHeader(cookie));
  assert.equal(badRole.status, 400);
  assert.match((await badRole.json()).message, /role/);

  const shortPassword = await request(
    base,
    'POST',
    '/api/admin/users',
    { ...valid, temporaryPassword: 'short' },
    cookieHeader(cookie)
  );
  assert.equal(shortPassword.status, 400);
  assert.match((await shortPassword.json()).message, /password_too_short/);

  const unknownField = await request(
    base,
    'POST',
    '/api/admin/users',
    { ...valid, isAdmin: true },
    cookieHeader(cookie)
  );
  assert.equal(unknownField.status, 400);
  assert.equal((await unknownField.json()).error, 'validation_error');

  const created = await request(base, 'POST', '/api/admin/users', valid, cookieHeader(cookie));
  assert.equal(created.status, 201);

  const duplicate = await request(base, 'POST', '/api/admin/users', valid, cookieHeader(cookie));
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error, 'email_exists');

  // S1: every admin after the first one is created through this API.
  const secondAdmin = await request(
    base,
    'POST',
    '/api/admin/users',
    { ...valid, email: 'second-admin@example.com', role: 'admin' },
    cookieHeader(cookie)
  );
  assert.equal(secondAdmin.status, 201);
  assert.equal((await secondAdmin.json()).user.role, 'admin');
});

test('PATCH /api/admin/users/:id updates fullName, role and isActive', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedAdmin(pool);
  const qaId = await seedUser(pool, { email: 'qa@example.com', password: 'qa password 12345' });
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  const renamed = await request(
    base,
    'PATCH',
    `/api/admin/users/${qaId}`,
    { fullName: 'Promoted User' },
    cookieHeader(adminCookie)
  );
  assert.equal(renamed.status, 200);
  assert.equal((await renamed.json()).user.fullName, 'Promoted User');

  const promoted = await request(
    base,
    'PATCH',
    `/api/admin/users/${qaId}`,
    { role: 'admin' },
    cookieHeader(adminCookie)
  );
  assert.equal(promoted.status, 200);
  assert.equal((await promoted.json()).user.role, 'admin');

  // The promoted user can log in; deactivating them kills that session.
  const qaCookie = await loginAs(base, 'qa@example.com', 'qa password 12345');
  const before = await request(base, 'GET', '/api/auth/me', undefined, cookieHeader(qaCookie));
  assert.equal(before.status, 200);

  const deactivated = await request(
    base,
    'PATCH',
    `/api/admin/users/${qaId}`,
    { isActive: false },
    cookieHeader(adminCookie)
  );
  assert.equal(deactivated.status, 200);
  assert.equal((await deactivated.json()).user.isActive, false);

  const after = await request(base, 'GET', '/api/auth/me', undefined, cookieHeader(qaCookie));
  assert.equal(after.status, 401);
  assert.equal((await after.json()).error, 'unauthenticated');

  const blockedLogin = await request(base, 'POST', '/api/auth/login', {
    email: 'qa@example.com',
    password: 'qa password 12345',
  });
  assert.equal(blockedLogin.status, 401);

  const reactivated = await request(
    base,
    'PATCH',
    `/api/admin/users/${qaId}`,
    { isActive: true },
    cookieHeader(adminCookie)
  );
  assert.equal(reactivated.status, 200);
  const relogin = await request(base, 'POST', '/api/auth/login', {
    email: 'qa@example.com',
    password: 'qa password 12345',
  });
  assert.equal(relogin.status, 200);

  const missing = await request(
    base,
    'PATCH',
    `/api/admin/users/${randomUUID()}`,
    { fullName: 'Ghost' },
    cookieHeader(adminCookie)
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'user_not_found');

  const emptyPatch = await request(base, 'PATCH', `/api/admin/users/${qaId}`, {}, cookieHeader(adminCookie));
  assert.equal(emptyPatch.status, 400);
  assert.equal((await emptyPatch.json()).error, 'validation_error');

  const foreignOrigin = await fetch(`${base}/api/admin/users/${qaId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: JSON.stringify({ fullName: 'Nope' }),
  });
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await foreignOrigin.json()).error, 'invalid_origin');
});

test('guards: an admin cannot demote or deactivate themselves', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminId = await seedAdmin(pool);
  await seedUser(pool, {
    email: 'second@example.com',
    password: 'second password 12',
    fullName: 'Second Admin',
    role: 'admin',
  });
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  const demoteSelf = await request(
    base,
    'PATCH',
    `/api/admin/users/${adminId}`,
    { role: 'qa_engineer' },
    cookieHeader(cookie)
  );
  assert.equal(demoteSelf.status, 409);
  assert.equal((await demoteSelf.json()).error, 'self_change');

  const deactivateSelf = await request(
    base,
    'PATCH',
    `/api/admin/users/${adminId}`,
    { isActive: false },
    cookieHeader(cookie)
  );
  assert.equal(deactivateSelf.status, 409);
  assert.equal((await deactivateSelf.json()).error, 'self_change');

  // The guards left the account untouched.
  const [[row]] = await pool.execute('SELECT role, is_active FROM users WHERE id = ?', [adminId]);
  assert.equal(row.role, 'admin');
  assert.equal(row.is_active, 1);

  // Renaming yourself is not a guard case.
  const renameSelf = await request(
    base,
    'PATCH',
    `/api/admin/users/${adminId}`,
    { fullName: 'Lead Admin' },
    cookieHeader(cookie)
  );
  assert.equal(renameSelf.status, 200);
});

test('guard: an admin cannot reset their own password through this API (409 self_change)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminId = await seedAdmin(pool);
  await seedUser(pool, {
    email: 'second@example.com',
    password: 'second password 12',
    fullName: 'Second Admin',
    role: 'admin',
  });
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const [[before]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [adminId]);

  // Resetting your own account would revoke your own session, so the screen
  // sends the admin to "Change password" (plan T9b adjustment).
  const resetSelf = await request(
    base,
    'POST',
    `/api/admin/users/${adminId}/reset-password`,
    { temporaryPassword: TEMP_PASSWORD },
    cookieHeader(cookie)
  );
  assert.equal(resetSelf.status, 409);
  assert.equal((await resetSelf.json()).error, 'self_change');

  // Nothing changed: the hash is untouched and the session survives.
  const [[after]] = await pool.execute('SELECT password_hash FROM users WHERE id = ?', [adminId]);
  assert.equal(after.password_hash, before.password_hash);
  const stillMe = await request(base, 'GET', '/api/auth/me', undefined, cookieHeader(cookie));
  assert.equal(stillMe.status, 200);

  // Resetting ANOTHER account still works, including one's own admin peer.
  const otherId = await seedUser(pool, {
    email: 'peer@example.com',
    password: 'peer password 123',
    fullName: 'Peer Admin',
    role: 'admin',
  });
  const resetOther = await request(
    base,
    'POST',
    `/api/admin/users/${otherId}/reset-password`,
    { temporaryPassword: TEMP_PASSWORD },
    cookieHeader(cookie)
  );
  assert.equal(resetOther.status, 204);
});

test('guard: at least one active admin must remain (409 last_admin)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminId = await seedAdmin(pool);
  const cookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  // Self-demote as the only admin is blocked by the invariant itself.
  const demote = await request(
    base,
    'PATCH',
    `/api/admin/users/${adminId}`,
    { role: 'qa_engineer' },
    cookieHeader(cookie)
  );
  assert.equal(demote.status, 409);
  assert.equal((await demote.json()).error, 'last_admin');

  const deactivate = await request(
    base,
    'PATCH',
    `/api/admin/users/${adminId}`,
    { isActive: false },
    cookieHeader(cookie)
  );
  assert.equal(deactivate.status, 409);
  assert.equal((await deactivate.json()).error, 'last_admin');

  const [[row]] = await pool.execute('SELECT role, is_active FROM users WHERE id = ?', [adminId]);
  assert.equal(row.role, 'admin');
  assert.equal(row.is_active, 1);

  // With a second admin, demoting the other one is allowed.
  const secondId = await seedUser(pool, {
    email: 'second@example.com',
    password: 'second password 12',
    fullName: 'Second Admin',
    role: 'admin',
  });
  const demoteOther = await request(
    base,
    'PATCH',
    `/api/admin/users/${secondId}`,
    { role: 'qa_engineer' },
    cookieHeader(cookie)
  );
  assert.equal(demoteOther.status, 200);
  assert.equal((await demoteOther.json()).user.role, 'qa_engineer');
});

test('reset-password sets a temporary password, forces the change and revokes every session', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedAdmin(pool);
  const qaId = await seedUser(pool, { email: 'qa@example.com', password: 'original password 1' });
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const qaCookie = await loginAs(base, 'qa@example.com', 'original password 1');

  const badPassword = await request(
    base,
    'POST',
    `/api/admin/users/${qaId}/reset-password`,
    { temporaryPassword: 'short' },
    cookieHeader(adminCookie)
  );
  assert.equal(badPassword.status, 400);
  assert.match((await badPassword.json()).message, /password_too_short/);

  const missing = await request(
    base,
    'POST',
    `/api/admin/users/${randomUUID()}/reset-password`,
    { temporaryPassword: TEMP_PASSWORD },
    cookieHeader(adminCookie)
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'user_not_found');

  const reset = await request(
    base,
    'POST',
    `/api/admin/users/${qaId}/reset-password`,
    { temporaryPassword: TEMP_PASSWORD },
    cookieHeader(adminCookie)
  );
  assert.equal(reset.status, 204);

  // Every session of the target user is revoked.
  const deadSession = await request(base, 'GET', '/api/auth/me', undefined, cookieHeader(qaCookie));
  assert.equal(deadSession.status, 401);
  assert.equal((await deadSession.json()).error, 'unauthenticated');

  // The old password no longer works; the temporary one does, with the flag.
  const oldPassword = await request(base, 'POST', '/api/auth/login', {
    email: 'qa@example.com',
    password: 'original password 1',
  });
  assert.equal(oldPassword.status, 401);
  assert.equal((await oldPassword.json()).error, 'invalid_credentials');

  const login = await request(base, 'POST', '/api/auth/login', {
    email: 'qa@example.com',
    password: TEMP_PASSWORD,
  });
  assert.equal(login.status, 200);
  const body = await login.json();
  assert.equal(body.user.mustChangePassword, true);

  const [[row]] = await pool.execute(
    'SELECT must_change_password, password_hash FROM users WHERE id = ?',
    [qaId]
  );
  assert.equal(row.must_change_password, 1);
  assert.notEqual(row.password_hash, await hashPassword(TEMP_PASSWORD));
  assert.equal(await (await import('../src/services/passwordService.js')).verify(TEMP_PASSWORD, row.password_hash), true);
});
