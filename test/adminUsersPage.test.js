import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';

// Integration tests for the admin users screen (plan T9b, specs S1/S5/S13,
// design §7.2 and §7.4). The page and its script are admin-only ON THE
// SERVER: a session with another role gets 403 even typing the URL, and
// index.html carries the "Users" link hidden until auth-bar.js sees an admin.
// The script is a thin client of the §7.2 API and must surface its error
// codes (409 last_admin, 409 self_change, 409 email_exists).
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
const ADMIN_EMAIL = 't9b-admin@example.com';
const ADMIN_PASSWORD = 't9b admin password 1';
const QA_EMAIL = 't9b-qa@example.com';
const QA_PASSWORD = 't9b qa password 123';

const ADMIN_PAGES = ['/admin-users.html', '/admin-users.js'];

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
    await pool.execute('DELETE FROM user_sessions');
    await pool.execute('DELETE FROM login_attempts');
    await pool.execute('DELETE FROM users');
    await pool.end();
  });

  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  await pool.execute('DELETE FROM users');
  for (const user of [
    { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, fullName: 'T9b Admin', role: 'admin' },
    { email: QA_EMAIL, password: QA_PASSWORD, fullName: 'T9b Engineer', role: 'qa_engineer' },
  ]) {
    await userRepository.create(pool, {
      id: randomUUID(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      passwordHash: await hashPassword(user.password),
      mustChangePassword: false,
      isActive: true,
      createdBy: null,
    });
  }

  const adminCookie = await login(base(server), ADMIN_EMAIL, ADMIN_PASSWORD);
  const qaCookie = await login(base(server), QA_EMAIL, QA_PASSWORD);
  return { base: base(server), adminCookie, qaCookie };
}

function base(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  const raw = response.headers.get('set-cookie') ?? '';
  return /qa_session=([^;]*)/.exec(raw)[1];
}

function get(baseUrl, path, cookie, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: cookie ? { Cookie: `qa_session=${cookie}` } : {},
    redirect: 'manual',
    ...options,
  });
}

test('anonymous visitors are redirected from the admin page (302)', { skip: skipReason }, async (t) => {
  const { base: baseUrl } = await startApp(t);

  for (const path of ADMIN_PAGES) {
    const response = await get(baseUrl, path, null);
    assert.equal(response.status, 302, `/${path}`);
    assert.equal(response.headers.get('location'), '/login.html', `/${path}`);
  }
});

test('the admin page answers 403 to a non-admin session even typing the URL', { skip: skipReason }, async (t) => {
  const { base: baseUrl, qaCookie } = await startApp(t);

  for (const path of ADMIN_PAGES) {
    const response = await get(baseUrl, path, qaCookie);
    assert.equal(response.status, 403, `/${path} as qa_engineer`);
    const body = await response.text();
    assert.match(body, /admin/i, `/${path} must name the required role`);
  }

  // The API keeps its own contract for the same session (§7.2, T9).
  const api = await fetch(`${baseUrl}/api/admin/users`, {
    headers: { Cookie: `qa_session=${qaCookie}` },
  });
  assert.equal(api.status, 403);
  assert.equal((await api.json()).error, 'forbidden');
});

test('an admin session gets the page, the script and no cached HTML', { skip: skipReason }, async (t) => {
  const { base: baseUrl, adminCookie } = await startApp(t);

  const page = await get(baseUrl, '/admin-users.html', adminCookie);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  assert.match(html, /id="au-form"/);
  assert.match(html, /id="au-users"/);
  assert.match(html, /id="au-reset-dialog"/);
  assert.match(html, /src="\/?admin-users\.js"/);
  assert.match(html, /href="\/?styles\.css"/);

  const script = await get(baseUrl, '/admin-users.js', adminCookie);
  assert.equal(script.status, 200);
  const body = await script.text();
  // Thin client of the §7.2 API: list, create, patch and reset.
  assert.match(body, /\/api\/admin\/users/);
  assert.match(body, /reset-password/);
  assert.match(body, /api\('POST', API/);
  assert.match(body, /api\('PATCH'/);
  // The API's own errors must reach the screen (T9b).
  assert.match(body, /last_admin/);
  assert.match(body, /self_change/);
  assert.match(body, /email_exists/);
  // Same redirect rule as the other screens: ONLY "unauthenticated".
  assert.match(body, /status\s*===\s*401\s*&&\s*body\??\.error\s*===\s*['"]unauthenticated['"]/);
});

test('index.html links to the admin page hidden, and auth-bar.js reveals it for admins', { skip: skipReason }, async (t) => {
  const { base: baseUrl, adminCookie } = await startApp(t);

  const index = await get(baseUrl, '/index.html', adminCookie);
  assert.equal(index.status, 200);
  const html = await index.text();
  const link = /<a[^>]*id="auth-users"[^>]*>/.exec(html);
  assert.ok(link, 'expected a "Users" link in the top bar');
  assert.match(link[0], /href="\/admin-users\.html"/);
  // Hidden in the markup: a non-admin never sees it flash in.
  assert.match(link[0], /\bhidden\b/);

  const bar = await get(baseUrl, '/auth-bar.js', adminCookie);
  assert.equal(bar.status, 200);
  const body = await bar.text();
  // Revealed only for the admin role (S13: "visible solo para admins").
  assert.match(body, /role\s*===\s*['"]admin['"]/);
  assert.match(body, /auth-users/);
});
