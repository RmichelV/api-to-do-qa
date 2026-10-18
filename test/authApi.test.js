import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword, verify as verifyPassword } from '../src/services/passwordService.js';

// Integration tests for the auth API (design §7.1, §5.2–§5.4) against a
// real database and a real HTTP server. Only TEST_DB_* — never DB_* (L10).
// Without them the file skips.
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

async function seedUser(pool, { email, password, role = 'admin', isActive = true, mustChangePassword = false } = {}) {
  const id = randomUUID();
  await userRepository.create(pool, {
    id,
    email,
    fullName: 'Auth Test User',
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

test('login returns the user, sets the session cookie and stores only the hash', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'login@example.com', password: 'correct horse battery' });

  const response = await post(base, '/api/auth/login', {
    email: ' login@example.com ',
    password: 'correct horse battery',
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.user).sort(), [
    'email',
    'fullName',
    'id',
    'mustChangePassword',
    'role',
  ]);
  assert.equal(body.user.email, 'login@example.com');
  assert.equal(body.user.role, 'admin');
  assert.equal(body.user.mustChangePassword, false);

  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /qa_session=[^;]+/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /Max-Age=604800/); // 7 days (§5.2)
  const token = sessionCookie(response);
  assert.ok(token && token.length > 20);

  const [[session]] = await pool.execute('SELECT * FROM user_sessions WHERE user_id = ?', [body.user.id]);
  assert.ok(session);
  assert.deepEqual(Buffer.from(session.token_hash), sha256(token)); // never the token itself
  assert.equal(session.previous_token_hash, null);
  assert.equal(session.revoked_at, null);

  const [[user]] = await pool.execute('SELECT last_login_at FROM users WHERE id = ?', [body.user.id]);
  assert.ok(user.last_login_at);
});

test('login rejects wrong password and unknown email with the same generic error', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'known@example.com', password: 'correct horse battery' });

  const wrong = await post(base, '/api/auth/login', {
    email: 'known@example.com',
    password: 'not-the-password-1',
  });
  assert.equal(wrong.status, 401);
  const wrongBody = await wrong.json();
  assert.deepEqual(wrongBody, {
    error: 'invalid_credentials',
    message: 'Invalid email or password.',
  });

  const unknown = await post(base, '/api/auth/login', {
    email: 'ghost@example.com',
    password: 'not-the-password-1',
  });
  assert.equal(unknown.status, 401);
  assert.deepEqual(await unknown.json(), wrongBody);

  const [attempts] = await pool.execute(
    'SELECT email, succeeded FROM login_attempts ORDER BY id'
  );
  assert.equal(attempts.length, 2);
  assert.ok(attempts.every((row) => row.succeeded === 0));
});

test('login validates the body (400 validation_error)', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await post(base, '/api/auth/login', { email: 'someone@example.com' });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'validation_error');
});

test('login is blocked after 5 failed attempts per email in 15 min (§5.4)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const password = 'correct horse battery';
  await seedUser(pool, { email: 'throttled@example.com', password });

  for (let i = 0; i < 5; i += 1) {
    const failed = await post(base, '/api/auth/login', {
      email: 'throttled@example.com',
      password: 'wrong-password-attempt',
    });
    assert.equal(failed.status, 401);
  }

  const blocked = await post(base, '/api/auth/login', {
    email: 'throttled@example.com',
    password, // correct, but the limit already applies
  });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'too_many_attempts');
});

test('login is blocked after 20 failed attempts per IP in 15 min (§5.4)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const password = 'correct horse battery';
  await seedUser(pool, { email: 'ip-probe@example.com', password });

  const first = await post(base, '/api/auth/login', {
    email: 'ip-probe@example.com',
    password: 'wrong-password-attempt',
  });
  assert.equal(first.status, 401);

  const [[{ ip_address: clientIp }]] = await pool.execute(
    'SELECT ip_address FROM login_attempts ORDER BY id DESC LIMIT 1'
  );
  assert.ok(clientIp);
  await pool.execute(
    'INSERT INTO login_attempts (email, ip_address, succeeded, attempted_at) ' +
      'SELECT ?, ?, 0, UTC_TIMESTAMP(3) FROM information_schema.tables LIMIT 20',
    [`noise-${randomUUID()}@example.com`, clientIp]
  );

  const blocked = await post(base, '/api/auth/login', {
    email: 'ip-probe@example.com',
    password,
  });
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error, 'too_many_attempts');
});

test('me answers 200 with the session and 401 without it', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'me@example.com', password: 'correct horse battery' });

  const missing = await get(base, '/api/auth/me');
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).error, 'unauthenticated');

  const login = await post(base, '/api/auth/login', {
    email: 'me@example.com',
    password: 'correct horse battery',
  });
  const token = sessionCookie(login);

  const response = await get(base, '/api/auth/me', cookieHeader(token));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.user.email, 'me@example.com');
});

test('inactive users cannot log in', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, {
    email: 'disabled@example.com',
    password: 'correct horse battery',
    isActive: false,
  });

  const response = await post(base, '/api/auth/login', {
    email: 'disabled@example.com',
    password: 'correct horse battery',
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'invalid_credentials');
});

test('relogin revokes the previous session carried in the cookie', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'relogin@example.com', password: 'correct horse battery' });

  const first = await post(base, '/api/auth/login', {
    email: 'relogin@example.com',
    password: 'correct horse battery',
  });
  const tokenA = sessionCookie(first);

  // Second login while still carrying the valid session cookie of the first.
  const second = await post(base, '/api/auth/login', {
    email: 'relogin@example.com',
    password: 'correct horse battery',
  }, cookieHeader(tokenA));
  assert.equal(second.status, 200);
  const tokenB = sessionCookie(second);
  assert.notEqual(tokenB, tokenA);

  const [[oldSession]] = await pool.execute('SELECT revoked_at FROM user_sessions WHERE token_hash = ?', [
    sha256(tokenA),
  ]);
  assert.ok(oldSession);
  assert.ok(oldSession.revoked_at, 'the session carried in the cookie must be revoked');

  const withOld = await get(base, '/api/auth/me', cookieHeader(tokenA));
  assert.equal(withOld.status, 401);

  const withNew = await get(base, '/api/auth/me', cookieHeader(tokenB));
  assert.equal(withNew.status, 200);
});

test('logout revokes the session, clears the cookie and is idempotent', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'logout@example.com', password: 'correct horse battery' });
  const login = await post(base, '/api/auth/login', {
    email: 'logout@example.com',
    password: 'correct horse battery',
  });
  const token = sessionCookie(login);

  const first = await post(base, '/api/auth/logout', undefined, cookieHeader(token));
  assert.equal(first.status, 204);
  const cleared = first.headers.get('set-cookie');
  assert.match(cleared, /qa_session=;/);
  assert.match(cleared, /Max-Age=0/);

  const [[session]] = await pool.execute('SELECT revoked_at FROM user_sessions WHERE token_hash = ?', [
    sha256(token),
  ]);
  assert.ok(session.revoked_at);

  const afterLogout = await get(base, '/api/auth/me', cookieHeader(token));
  assert.equal(afterLogout.status, 401);

  const again = await post(base, '/api/auth/logout', undefined, cookieHeader(token));
  assert.equal(again.status, 204); // idempotent (§7.1)
});

test('logout without a session still answers 204', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await post(base, '/api/auth/logout', undefined);
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('the token rotates after 24 h of use, keeping the old one for 60 s (§5.2)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'rotate@example.com', password: 'correct horse battery' });
  const login = await post(base, '/api/auth/login', {
    email: 'rotate@example.com',
    password: 'correct horse battery',
  });
  const tokenA = sessionCookie(login);
  const [[row]] = await pool.execute('SELECT id FROM user_sessions WHERE token_hash = ?', [
    sha256(tokenA),
  ]);

  await pool.execute(
    'UPDATE user_sessions SET rotated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 25 HOUR) WHERE id = ?',
    [row.id]
  );

  const rotating = await get(base, '/api/auth/me', cookieHeader(tokenA));
  assert.equal(rotating.status, 200);
  const tokenB = sessionCookie(rotating);
  assert.ok(tokenB);
  assert.notEqual(tokenB, tokenA);

  const [[afterRotation]] = await pool.execute(
    'SELECT token_hash, previous_token_hash FROM user_sessions WHERE id = ?',
    [row.id]
  );
  assert.deepEqual(Buffer.from(afterRotation.token_hash), sha256(tokenB));
  assert.deepEqual(Buffer.from(afterRotation.previous_token_hash), sha256(tokenA));

  // Old token inside the 60 s grace: still accepted, no new cookie issued.
  const withinGrace = await get(base, '/api/auth/me', cookieHeader(tokenA));
  assert.equal(withinGrace.status, 200);
  assert.equal(withinGrace.headers.get('set-cookie'), null);

  // Past the grace: rejected.
  await pool.execute(
    'UPDATE user_sessions SET rotated_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 61 SECOND) WHERE id = ?',
    [row.id]
  );
  const afterGrace = await get(base, '/api/auth/me', cookieHeader(tokenA));
  assert.equal(afterGrace.status, 401);

  const withCurrent = await get(base, '/api/auth/me', cookieHeader(tokenB));
  assert.equal(withCurrent.status, 200);
});

test('expired sessions are rejected', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'expired@example.com', password: 'correct horse battery' });
  const login = await post(base, '/api/auth/login', {
    email: 'expired@example.com',
    password: 'correct horse battery',
  });
  const token = sessionCookie(login);

  await pool.execute(
    'UPDATE user_sessions SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)'
  );
  const response = await get(base, '/api/auth/me', cookieHeader(token));
  assert.equal(response.status, 401);
});

test('state-changing auth requests require a matching Origin (§5.3)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'origin@example.com', password: 'correct horse battery' });
  const credentials = { email: 'origin@example.com', password: 'correct horse battery' };

  const withoutOrigin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  assert.equal(withoutOrigin.status, 403);
  assert.equal((await withoutOrigin.json()).error, 'invalid_origin');

  const foreign = await post(base, '/api/auth/login', credentials, {
    Origin: 'https://evil.example',
  });
  assert.equal(foreign.status, 403);
});

test('API responses carry the security headers of design §5.6', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/api/auth/me');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'same-origin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('last_seen_at is refreshed at most once every 5 minutes', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'touch@example.com', password: 'correct horse battery' });
  const login = await post(base, '/api/auth/login', {
    email: 'touch@example.com',
    password: 'correct horse battery',
  });
  const token = sessionCookie(login);

  await pool.execute(
    'UPDATE user_sessions SET last_seen_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 6 MINUTE)'
  );
  const before = await pool.execute('SELECT last_seen_at FROM user_sessions');
  const response = await get(base, '/api/auth/me', cookieHeader(token));
  assert.equal(response.status, 200);
  const [[after]] = await pool.execute('SELECT last_seen_at FROM user_sessions');
  assert.ok(
    new Date(after.last_seen_at).getTime() > new Date(before[0][0].last_seen_at).getTime()
  );
});

test('the stored hash verifies against the original password', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, { email: 'hash@example.com', password: 'correct horse battery' });
  const [[user]] = await pool.execute('SELECT password_hash FROM users WHERE email = ?', [
    'hash@example.com',
  ]);
  assert.equal(await verifyPassword('correct horse battery', user.password_hash), true);
  assert.equal(await verifyPassword('nope', user.password_hash), false);
});
