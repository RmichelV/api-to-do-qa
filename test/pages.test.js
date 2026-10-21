import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPool } from '../src/db/pool.js';
import { createApp } from '../src/app.js';

// Integration tests for the T7 screens (design §7.4, plan T7): the public
// login page from public-auth/, the change-password page from public/, and
// index.html still serving the QA tool unchanged plus its new top bar.
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
  return { base: `http://127.0.0.1:${server.address().port}` };
}

function get(base, path, headers = {}) {
  return fetch(`${base}${path}`, { headers });
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
  // success goes to "/", and the page never bounces back to /login.html
  assert.match(body, /location\.href\s*=\s*['"]\/['"]/);
  assert.doesNotMatch(body, /login\.html/);
});

test('GET /auth-bar.js serves the top-bar script with the unauthenticated-only redirect', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/auth-bar.js');
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\/api\/auth\/me/);
  assert.match(body, /\/api\/auth\/logout/);
  // T7 note: redirect to /login.html ONLY when error === "unauthenticated",
  // never on any other 401 (or any other status).
  assert.match(body, /status\s*===\s*401\s*&&\s*body\??\.error\s*===\s*['"]unauthenticated['"]/);
});

test('GET /change-password.html serves the change-password page', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/change-password.html');
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

test('GET /change-password.js serves the change-password script', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/change-password.js');
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /\/api\/auth\/change-password/);
});

test('GET /styles.css still serves the shared stylesheet', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/styles.css');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/css/);
});

test('GET /index.html still serves the QA tool, now with the auth top bar', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  // T7 does not block the app yet: without a session the page is still sent.
  const response = await get(base, '/index.html');
  assert.equal(response.status, 200);
  const html = await response.text();
  // QA logic untouched (S12)
  assert.match(html, /id="url"/);
  assert.match(html, /runFullAnalysis/);
  assert.match(html, /toggleTodoPanel/);
  // new top bar: user name, change password, logout (§7.4)
  assert.match(html, /id="auth-user-name"/);
  assert.match(html, /id="auth-change-password"/);
  assert.match(html, /href="\/change-password\.html"/);
  assert.match(html, /id="auth-logout"/);
  assert.match(html, /src="\/?auth-bar\.js"/);
});

test('GET /api/auth/me answers 401 unauthenticated without a session (top-bar contract)', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);
  const response = await get(base, '/api/auth/me');
  assert.equal(response.status, 401);
  const body = await response.json();
  // The pages redirect to /login.html ONLY when error === "unauthenticated".
  assert.equal(body.error, 'unauthenticated');
});
