import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';

// Integration tests for the T7 screens under the T8 protection model
// (design §7.4, §6): the login page stays public, everything else in public/
// requires a session, and index.html keeps the QA tool plus its auth bar.
// Real HTTP server. Only TEST_DB_* — never DB_* (L10); skips without them.
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
  const base = `http://127.0.0.1:${server.address().port}`;

  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  await pool.execute('DELETE FROM users');
  await userRepository.create(pool, {
    id: randomUUID(),
    email: 'pages@example.com',
    fullName: 'Pages User',
    role: 'qa_engineer',
    passwordHash: await hashPassword('pages password 123'),
    mustChangePassword: false,
    isActive: true,
    createdBy: null,
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: JSON.stringify({ email: 'pages@example.com', password: 'pages password 123' }),
  });
  assert.equal(login.status, 200);
  const raw = login.headers.get('set-cookie') ?? '';
  const cookie = /qa_session=([^;]*)/.exec(raw)[1];

  return { base, cookie };
}

function get(base, path, headers = {}, options = {}) {
  return fetch(`${base}${path}`, { headers, ...options });
}

test('GET /login.html serves the public login page', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/login.html');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  const html = await response.text();
  // email/password form wired to POST /api/auth/login (§7.1)
  assert.match(html, /id="login-form"/);
  assert.match(html, /id="login-email"/);
  assert.match(html, /id="login-password"/);
  assert.match(html, /src="\/?login\.js"/);
  assert.match(html, /href="\/?styles\.css"/);
  // no QA tooling on the public page
  assert.doesNotMatch(html, /runFullAnalysis/);
});

test('GET /login.js serves the login script', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/login.js');
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\/api\/auth\/login/);
  // success goes to "/", and the page never bounces back to itself
  assert.match(body, /location\.href\s*=\s*['"]\/['"]/);
  assert.doesNotMatch(body, /login\.html/);
});

test('GET /change-password.html requires a session and serves the page with one', { skip: skipReason }, async (t) => {
  const { base, cookie } = await startApp(t);

  // redirect: 'manual' to assert the 302 itself (pattern from T6).
  const anon = await get(base, '/change-password.html', {}, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/login.html');

  const response = await get(base, '/change-password.html', { Cookie: `qa_session=${cookie}` });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /id="cp-current"/);
  assert.match(html, /id="cp-new"/);
  assert.match(html, /id="cp-confirm"/);
  // policy visible on the page (§5.1: 12 to 128 characters)
  assert.match(html, /12/);
  assert.match(html, /128/);
  assert.match(html, /src="\/?change-password\.js"/);
  assert.match(html, /href="\/?styles\.css"/);
});

test('GET /change-password.js requires a session and serves the script with one', { skip: skipReason }, async (t) => {
  const { base, cookie } = await startApp(t);

  const anon = await get(base, '/change-password.js', {}, { redirect: 'manual' });
  assert.equal(anon.status, 302);

  const response = await get(base, '/change-password.js', { Cookie: `qa_session=${cookie}` });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\/api\/auth\/change-password/);
});

test('GET /auth-bar.js requires a session and serves the unauthenticated-only redirect with one', { skip: skipReason }, async (t) => {
  const { base, cookie } = await startApp(t);

  const anon = await get(base, '/auth-bar.js', {}, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/login.html');

  const response = await get(base, '/auth-bar.js', { Cookie: `qa_session=${cookie}` });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\/api\/auth\/me/);
  assert.match(body, /\/api\/auth\/logout/);
  // T7 note: redirect to /login.html ONLY when error === "unauthenticated",
  // never on any other 401 (or any other status).
  assert.match(body, /status\s*===\s*401\s*&&\s*body\??\.error\s*===\s*['"]unauthenticated['"]/);
});

test('GET /styles.css still serves the shared stylesheet publicly', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/styles.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/css/);
});

test('GET /index.html requires a session and keeps the QA tool plus the auth top bar', { skip: skipReason }, async (t) => {
  const { base, cookie } = await startApp(t);

  const anon = await get(base, '/index.html', {}, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('location'), '/login.html');

  const response = await get(base, '/index.html', { Cookie: `qa_session=${cookie}` });
  assert.equal(response.status, 200);
  const html = await response.text();
  // QA logic untouched (S12)
  assert.match(html, /id="url"/);
  assert.match(html, /runFullAnalysis/);
  assert.match(html, /toggleTodoPanel/);
  // auth top bar: user name, change password, logout (§7.4)
  assert.match(html, /id="auth-user-name"/);
  assert.match(html, /id="auth-change-password"/);
  assert.match(html, /href="\/change-password\.html"/);
  assert.match(html, /id="auth-logout"/);
  assert.match(html, /src="\/?auth-bar\.js"/);
});

test('protected HTML answers Cache-Control: no-store (T8, L25)', { skip: skipReason }, async (t) => {
  const { base, cookie } = await startApp(t);
  const headers = { Cookie: `qa_session=${cookie}` };
  // GET / (the index page) and the .html files of public/ are protected
  // HTML: they must never be kept in browser/proxy caches.
  for (const path of ['/', '/index.html', '/change-password.html']) {
    const response = await get(base, path, headers);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
  }
  // The login redirect of an anonymous request carries it too, so a proxy
  // can never cache the 302 to /login.html.
  const anon = await get(base, '/change-password.html', {}, { redirect: 'manual' });
  assert.equal(anon.status, 302);
  assert.equal(anon.headers.get('cache-control'), 'no-store');
});

test('GET /api/auth/me answers 401 unauthenticated without a session (top-bar contract)', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/api/auth/me');
  assert.equal(response.status, 401);
  const body = await response.json();
  // The pages redirect to /login.html ONLY when error === "unauthenticated".
  assert.equal(body.error, 'unauthenticated');
});
