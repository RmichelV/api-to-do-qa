import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword, verify as verifyPassword } from '../src/services/passwordService.js';

// Integration tests for POST /api/auth/change-password and the forced
// password-change flow (design §7.1, §5.1, §5.2, §5.5). Real database and
// real HTTP server. Only TEST_DB_* — never DB_* (L10); skips without them.
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

function sha256(value) {
  return createHash('sha256').update(value).digest();
}

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
    await pool.end();
  });
  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  await pool.execute('DELETE FROM users');
  return { base: `http://127.0.0.1:${server.address().port}`, pool };
}

async function seedUser(
  pool,
  { email, password, role = 'admin', isActive = true, mustChangePassword = false } = {}
) {
  const id = randomUUID();
  await userRepository.create(pool, {
    id,
    email,
    fullName: 'Change Password User',
    role,
    passwordHash: await hashPassword(password),
    mustChangePassword,
    isActive,
    createdBy: null,
  });
  return id;
}

function post(base, path, body, headers = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

function get(base, path, headers = {}) {
  return fetch(`${base}${path}`, { headers: { Origin: APP_ORIGIN, ...headers } });
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
  const response = await post(base, '/api/auth/login', { email, password });
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

const OLD_PASSWORD = 'old password 123';
const NEW_PASSWORD = 'brand new password';

test('change-password requires a session and a matching Origin', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-auth@example.com', password: OLD_PASSWORD });

  const noSession = await post(base, '/api/auth/change-password', {
    currentPassword: OLD_PASSWORD,
    newPassword: NEW_PASSWORD,
  });
  assert.equal(noSession.status, 401);
  assert.equal((await noSession.json()).error, 'unauthenticated');

  const foreignOrigin = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
    { Origin: 'https://evil.example' }
  );
  assert.equal(foreignOrigin.status, 403);
  assert.equal((await foreignOrigin.json()).error, 'invalid_origin');
});

test('a wrong current password answers 401 and changes nothing', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, {
    email: 'cp-wrong@example.com',
    password: OLD_PASSWORD,
    mustChangePassword: true,
  });
  const token = await loginAs(base, 'cp-wrong@example.com', OLD_PASSWORD);

  const response = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: 'not the password', newPassword: NEW_PASSWORD },
    cookieHeader(token)
  );
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_credentials');

  const [[user]] = await pool.execute(
    'SELECT password_hash, must_change_password FROM users WHERE email = ?',
    ['cp-wrong@example.com']
  );
  assert.equal(await verifyPassword(OLD_PASSWORD, user.password_hash), true);
  assert.equal(user.must_change_password, 1);
  // The session survives: only the password was refused.
  const me = await get(base, '/api/auth/me', cookieHeader(token));
  assert.equal(me.status, 200);
});

test('change-password validates the body (400 validation_error)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-body@example.com', password: OLD_PASSWORD });
  const token = await loginAs(base, 'cp-body@example.com', OLD_PASSWORD);

  for (const body of [
    { currentPassword: OLD_PASSWORD }, // missing newPassword
    { newPassword: NEW_PASSWORD }, // missing currentPassword
    { currentPassword: '', newPassword: NEW_PASSWORD },
    { currentPassword: OLD_PASSWORD, newPassword: '' },
  ]) {
    const response = await post(base, '/api/auth/change-password', body, cookieHeader(token));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).error, 'validation_error');
  }
});

test('policy: the new password must differ from the current one (§5.1)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-same@example.com', password: OLD_PASSWORD });
  const token = await loginAs(base, 'cp-same@example.com', OLD_PASSWORD);

  const response = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD },
    cookieHeader(token)
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'validation_error');
  assert.match(body.message, /password_same_as_current/);

  const [[user]] = await pool.execute('SELECT password_hash FROM users WHERE email = ?', [
    'cp-same@example.com',
  ]);
  assert.equal(await verifyPassword(OLD_PASSWORD, user.password_hash), true);
});

test('policy: the new password must be at least 12 characters (§5.1)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-short@example.com', password: OLD_PASSWORD });
  const token = await loginAs(base, 'cp-short@example.com', OLD_PASSWORD);

  const response = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: 'short12345' },
    cookieHeader(token)
  );
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'validation_error');
  assert.match(body.message, /password_too_short/);
});

test('change-password updates the hash, clears the flag and rotates the current session (§5.2)', {
  skip: skipReason,
}, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, {
    email: 'cp-happy@example.com',
    password: OLD_PASSWORD,
    mustChangePassword: true,
  });
  const oldToken = await loginAs(base, 'cp-happy@example.com', OLD_PASSWORD);
  const [[before]] = await pool.execute('SELECT expires_at FROM user_sessions WHERE token_hash = ?', [
    sha256(oldToken),
  ]);

  const response = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
    cookieHeader(oldToken)
  );
  assert.equal(response.status, 204);

  const newToken = sessionCookie(response);
  assert.ok(newToken, 'a rotated cookie must be issued');
  assert.notEqual(newToken, oldToken);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);

  const [[user]] = await pool.execute(
    'SELECT password_hash, must_change_password, password_changed_at FROM users WHERE email = ?',
    ['cp-happy@example.com']
  );
  assert.equal(await verifyPassword(NEW_PASSWORD, user.password_hash), true);
  assert.equal(await verifyPassword(OLD_PASSWORD, user.password_hash), false);
  assert.equal(user.must_change_password, 0);
  assert.ok(user.password_changed_at);

  const [[session]] = await pool.execute(
    'SELECT token_hash, previous_token_hash, expires_at, revoked_at FROM user_sessions WHERE token_hash = ?',
    [sha256(newToken)]
  );
  assert.deepEqual(Buffer.from(session.token_hash), sha256(newToken));
  assert.deepEqual(Buffer.from(session.previous_token_hash), sha256(oldToken));
  assert.equal(session.revoked_at, null);
  // Rotation never extends the 7-day lifetime (§5.2).
  assert.equal(
    new Date(session.expires_at).getTime(),
    new Date(before.expires_at).getTime()
  );

  const me = await get(base, '/api/auth/me', cookieHeader(newToken));
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal(meBody.user.mustChangePassword, false);
});

test('change-password revokes every other session of the user (§5.2)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-multi@example.com', password: OLD_PASSWORD });
  // Two independent logins (no cookie carried) → two live sessions.
  const tokenA = await loginAs(base, 'cp-multi@example.com', OLD_PASSWORD);
  const tokenB = await loginAs(base, 'cp-multi@example.com', OLD_PASSWORD);

  const response = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
    cookieHeader(tokenB)
  );
  assert.equal(response.status, 204);
  const tokenC = sessionCookie(response);

  const withA = await get(base, '/api/auth/me', cookieHeader(tokenA));
  assert.equal(withA.status, 401, 'the other session must be revoked');
  const [[other]] = await pool.execute('SELECT revoked_at FROM user_sessions WHERE token_hash = ?', [
    sha256(tokenA),
  ]);
  assert.ok(other.revoked_at);

  const withC = await get(base, '/api/auth/me', cookieHeader(tokenC));
  assert.equal(withC.status, 200);
});

test('while must_change_password is set, only the change flow is allowed (§5.5)', {
  skip: skipReason,
}, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, {
    email: 'cp-forced@example.com',
    password: OLD_PASSWORD,
    mustChangePassword: true,
  });
  // Login already reports the flag so the frontend can redirect (T7).
  // §6 order note: POST login is public (step 4), above the gate (step 7),
  // so this re-login while flagged succeeds with 200 and the flag set —
  // §5.5 still holds because the gate below blocks everything else. Use
  // this fresh session for the rest of the flow (it replaces the old one).
  const login = await post(base, '/api/auth/login', {
    email: 'cp-forced@example.com',
    password: OLD_PASSWORD,
  });
  assert.equal((await login.json()).user.mustChangePassword, true);
  const token = sessionCookie(login);

  // Allowed: me, logout, change-password.
  const me = await get(base, '/api/auth/me', cookieHeader(token));
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.mustChangePassword, true);

  // Blocked: any other API, including the QA routes.
  const qa = await post(base, '/api/cancel', undefined, cookieHeader(token));
  assert.equal(qa.status, 403);
  assert.deepEqual(await qa.json(), {
    error: 'password_change_required',
    message: 'You must change your password before continuing.',
  });

  // Blocked: protected pages redirect to the change-password screen.
  // redirect: 'manual' to assert the 302 itself — the page lands in T7.
  const page = await fetch(`${base}/index.html`, {
    headers: { Origin: APP_ORIGIN, ...cookieHeader(token) },
    redirect: 'manual',
  });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/change-password.html');

  // The shared stylesheet still loads while forced, so the change screen
  // can render (§5.5 allows the change-password page and its assets).
  const css = await get(base, '/styles.css', cookieHeader(token));
  assert.equal(css.status, 200);

  // Completing the change lifts the gate.
  const changed = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
    cookieHeader(token)
  );
  assert.equal(changed.status, 204);
  const newToken = sessionCookie(changed);
  const qaAfter = await post(base, '/api/cancel', undefined, cookieHeader(newToken));
  assert.equal(qaAfter.status, 200);
});

test('logout stays available while the password change is pending (§5.5)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, {
    email: 'cp-logout@example.com',
    password: OLD_PASSWORD,
    mustChangePassword: true,
  });
  const token = await loginAs(base, 'cp-logout@example.com', OLD_PASSWORD);

  const logout = await post(base, '/api/auth/logout', undefined, cookieHeader(token));
  assert.equal(logout.status, 204);
});

test('5 wrong current passwords block change-password with 429 (§5.4)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-throttle@example.com', password: OLD_PASSWORD });
  const token = await loginAs(base, 'cp-throttle@example.com', OLD_PASSWORD);

  for (let i = 0; i < 5; i += 1) {
    const failed = await post(
      base,
      '/api/auth/change-password',
      { currentPassword: 'wrong current password', newPassword: NEW_PASSWORD },
      cookieHeader(token)
    );
    assert.equal(failed.status, 401);
    assert.equal((await failed.json()).error, 'invalid_credentials');
  }

  // Every failure is recorded in login_attempts (operational log, §5.4).
  // The initial login recorded a success row, so count failures only.
  const [attempts] = await pool.execute(
    'SELECT email, succeeded FROM login_attempts WHERE email = ? AND succeeded = 0 ORDER BY id',
    ['cp-throttle@example.com']
  );
  assert.equal(attempts.length, 5);
  assert.ok(attempts.every((row) => row.succeeded === 0));

  // The 6th attempt is refused before the password is even checked…
  const blocked = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
    cookieHeader(token)
  );
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'too_many_attempts');

  // …and the blocked attempt records nothing new.
  const [[{ n }]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND succeeded = 0',
    ['cp-throttle@example.com']
  );
  assert.equal(Number(n), 5);

  // The limit is shared with login: same table, same window, same cap.
  const login = await post(base, '/api/auth/login', {
    email: 'cp-throttle@example.com',
    password: OLD_PASSWORD,
  });
  assert.equal(login.status, 429);
  assert.equal((await login.json()).error, 'too_many_attempts');
});

test('a voluntary change (flag already 0) works the same way', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'cp-voluntary@example.com', password: OLD_PASSWORD });
  const token = await loginAs(base, 'cp-voluntary@example.com', OLD_PASSWORD);

  const response = await post(
    base,
    '/api/auth/change-password',
    { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
    cookieHeader(token)
  );
  assert.equal(response.status, 204);
  const newToken = sessionCookie(response);
  assert.notEqual(newToken, token);

  const [[user]] = await pool.execute(
    'SELECT password_hash, must_change_password FROM users WHERE email = ?',
    ['cp-voluntary@example.com']
  );
  assert.equal(await verifyPassword(NEW_PASSWORD, user.password_hash), true);
  assert.equal(user.must_change_password, 0);

  const me = await get(base, '/api/auth/me', cookieHeader(newToken));
  assert.equal(me.status, 200);
});
