import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import * as qaRecordRepository from '../src/repositories/qaRecordRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';
import { PUBLIC_DIR } from '../src/paths.js';

// Integration tests for POST /api/qa-records (PLAN F2): one record per Task
// ID, owner taken from the session, the D3 summary shape validated by the
// server (16 KB cap), and 409 on a duplicate ("no se puede guardar otro
// encima"). Real database and real HTTP server.
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
    // qa_records.owner_id REFERENCES users (RESTRICT): wipe children first so
    // the next test file starts from an empty table (FK-safe order).
    await pool.execute('DELETE FROM user_sessions');
    await pool.execute('DELETE FROM login_attempts');
    await pool.execute('DELETE FROM qa_records');
    await pool.execute('DELETE FROM users WHERE created_by IS NOT NULL');
    await pool.execute('DELETE FROM users');
    await pool.end();
  });
  await pool.execute('DELETE FROM user_sessions');
  await pool.execute('DELETE FROM login_attempts');
  await pool.execute('DELETE FROM qa_records');
  await pool.execute('DELETE FROM users WHERE created_by IS NOT NULL');
  await pool.execute('DELETE FROM users');
  return { base: `http://127.0.0.1:${server.address().port}`, pool };
}

async function seedUser(pool, { email, password, fullName = 'Seed User', role = 'qa_engineer' } = {}) {
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

const ENGINEER_EMAIL = 'engineer@example.com';
const ENGINEER_PASSWORD = 'engineer password 123';

// The D3 summary of PLAN F1, verbatim from the plan.
function summaryFixture() {
  return {
    version: 1,
    ranAt: '2026-11-07T14:03:00Z',
    checks: {
      h1: { status: 'fail', total: 2, failed: 1, items: ['Found 2 H1 tags'] },
      linkStatus: {
        status: 'fail',
        total: 120,
        failed: 2,
        items: [{ url: 'https://example.com/old-page', code: 404 }],
      },
      linksAdded: { status: 'pass', total: 8, failed: 0 },
      textDesktop: { status: 'fail', total: 54, failed: 1, items: ['Missing: "Schedule service…"'] },
      textMobile: { status: 'pass', total: 54, failed: 0 },
      images: { status: 'pass', total: 12, failed: 0 },
      anchors: { status: 'not_run' },
    },
  };
}

function saveBody(overrides = {}) {
  return {
    taskId: 'D-174735',
    pageUrl: 'https://example.com/inventory/',
    note: 'Special spec: keep the CTA above the fold.',
    summary: summaryFixture(),
    ...overrides,
  };
}

async function seedAndLogin(t) {
  const { base, pool } = await startApp(t);
  const ownerId = await seedUser(pool, {
    email: ENGINEER_EMAIL,
    password: ENGINEER_PASSWORD,
    fullName: 'QA Engineer',
  });
  const cookie = await loginAs(base, ENGINEER_EMAIL, ENGINEER_PASSWORD);
  return { base, pool, ownerId, cookie };
}

test('POST /api/qa-records requires a session', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);

  const response = await request(base, 'POST', '/api/qa-records', saveBody());

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, 'unauthenticated');
});

test('saving a QA stores one record owned by the session user (D3, D12)', { skip: skipReason }, async (t) => {
  const { base, pool, ownerId, cookie } = await seedAndLogin(t);

  const response = await request(base, 'POST', '/api/qa-records', saveBody(), cookieHeader(cookie));

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.record.taskId, 'D-174735');
  assert.equal(body.record.ownerId, ownerId);
  assert.equal(body.record.pageUrl, 'https://example.com/inventory/');
  assert.equal(body.record.note, 'Special spec: keep the CTA above the fold.');
  assert.deepEqual(body.record.summary, summaryFixture());

  const stored = await qaRecordRepository.findByTaskId(pool, 'D-174735');
  assert.equal(stored.owner_id, ownerId);
  assert.equal(stored.note_for_shadow, 'Special spec: keep the CTA above the fold.');
  assert.deepEqual(stored.summary, summaryFixture());
  // Review fields stay empty until a QA Shadow closes the record (F5).
  assert.equal(stored.reviewer_id, null);
  assert.equal(stored.qa_status, null);
  assert.equal(stored.checklist, null);
  assert.equal(stored.critical_count, 0);
  assert.deepEqual(stored.bugs, []);
});

test('a second save with the same Task ID answers 409 and leaves the first intact', { skip: skipReason }, async (t) => {
  const { base, pool, cookie } = await seedAndLogin(t);

  const first = await request(base, 'POST', '/api/qa-records', saveBody(), cookieHeader(cookie));
  assert.equal(first.status, 201);

  const second = await request(
    base,
    'POST',
    '/api/qa-records',
    saveBody({ note: 'Overwritten?', summary: { version: 1, checks: {} } }),
    cookieHeader(cookie)
  );
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, 'task_id_exists');

  const stored = await qaRecordRepository.findByTaskId(pool, 'D-174735');
  assert.equal(stored.note_for_shadow, 'Special spec: keep the CTA above the fold.');
  assert.deepEqual(stored.summary, summaryFixture());
  assert.equal((await qaRecordRepository.list(pool)).length, 1);
});

test('the Task ID is normalized to uppercase (D22)', { skip: skipReason }, async (t) => {
  const { base, pool, cookie } = await seedAndLogin(t);

  const response = await request(base, 'POST', '/api/qa-records', saveBody({ taskId: 'd-174735' }), cookieHeader(cookie));

  assert.equal(response.status, 201);
  assert.equal((await response.json()).record.taskId, 'D-174735');
  assert.equal((await qaRecordRepository.findByTaskId(pool, 'D-174735')).task_id, 'D-174735');
});

test('invalid Task IDs are rejected with 400 (D22: one letter, a dash and numbers)', { skip: skipReason }, async (t) => {
  const { base, cookie } = await seedAndLogin(t);
  const invalid = ['174735', 'D174735', 'D-', '-1', 'D-174735abc', 'D-17.4735', 'DA-174735', '   ', 42, null];

  for (const taskId of invalid) {
    const response = await request(base, 'POST', '/api/qa-records', saveBody({ taskId }), cookieHeader(cookie));
    assert.equal(response.status, 400, `taskId ${JSON.stringify(taskId)} must be rejected`);
    assert.equal((await response.json()).error, 'validation_error', `taskId ${JSON.stringify(taskId)}`);
  }
});

test('the server validates the D3 summary shape', { skip: skipReason }, async (t) => {
  const { base, cookie } = await seedAndLogin(t);
  const badSummaries = [
    undefined,
    null,
    'not-an-object',
    { version: 1 },
    { version: 1, checks: [] },
    { version: 1, checks: { h1: { status: 'oops' } } },
    { version: 1, checks: { h1: { status: 'fail', total: -1, failed: 0 } } },
    { version: 1, checks: { h1: { status: 'fail', total: '2', failed: 0 } } },
    { version: 1, checks: { h1: { status: 'fail', total: 2, failed: 1, items: 'Found 2 H1 tags' } } },
    // 20 items per check is the cap (D3).
    { version: 1, checks: { h1: { status: 'fail', total: 21, failed: 21, items: Array(21).fill('x') } } },
    // 200 characters per item is the cap (D3).
    { version: 1, checks: { h1: { status: 'fail', total: 1, failed: 1, items: ['x'.repeat(201)] } } },
    // D32: `result` is one line of at most 200 characters.
    { version: 1, checks: { h1: { status: 'fail', result: 42 } } },
    { version: 1, checks: { h1: { status: 'fail', result: 'x'.repeat(201) } } },
    // D32: `found` follows the same caps as `items`.
    { version: 1, checks: { h1: { status: 'pass', found: 'H1: Home' } } },
    { version: 1, checks: { h1: { status: 'pass', found: Array(21).fill('H1: x') } } },
    { version: 1, checks: { h1: { status: 'pass', found: ['x'.repeat(201)] } } },
  ];

  for (const summary of badSummaries) {
    const response = await request(base, 'POST', '/api/qa-records', saveBody({ summary }), cookieHeader(cookie));
    assert.equal(response.status, 400, `summary ${JSON.stringify(summary)} must be rejected`);
    assert.equal((await response.json()).error, 'validation_error');
  }
});

test('the readable summary keeps each check result, what it found and every finding (D32)', { skip: skipReason }, async (t) => {
  const { base, pool, cookie } = await seedAndLogin(t);
  const summary = {
    version: 1,
    ranAt: '2026-11-10T14:03:00Z',
    checks: {
      h1: {
        status: 'fail',
        result: 'There are 2 visible H1s (expected: 1)',
        total: 2,
        failed: 1,
        found: ['H1: Home', 'H1: Service'],
        items: [
          { bugId: 'FAIL-10', device: 'D', text: 'H1: Home' },
          { bugId: 'FAIL-10', device: 'D', text: 'H1: Service' },
        ],
      },
      linkStatus: {
        status: 'fail',
        result: '1 of 21 links failed (1 not returning 200)',
        total: 21,
        failed: 1,
        items: [{ bugId: 'FAIL-06', device: 'D', text: '404 "Old page" https://dealer.example/old-page' }],
      },
    },
  };

  const response = await request(base, 'POST', '/api/qa-records', saveBody({ taskId: 'D-147856', summary }), cookieHeader(cookie));

  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).record.summary, summary);
  assert.deepEqual((await qaRecordRepository.findByTaskId(pool, 'D-147856')).summary, summary);
});

test('a summary over 16 KB is rejected with 400 (D3)', { skip: skipReason }, async (t) => {
  const { base, pool, cookie } = await seedAndLogin(t);
  const long = 'x'.repeat(200);
  const checks = {};
  for (const name of ['h1', 'linkStatus', 'linksAdded', 'textDesktop', 'textMobile', 'images', 'anchors']) {
    checks[name] = { status: 'fail', total: 20, failed: 20, items: Array(20).fill(long) };
  }
  const big = { version: 1, ranAt: '2026-11-07T14:03:00Z', checks };
  assert.ok(JSON.stringify(big).length > 16 * 1024, 'fixture must exceed the cap');

  const response = await request(base, 'POST', '/api/qa-records', saveBody({ summary: big }), cookieHeader(cookie));

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'validation_error');
  assert.equal(await qaRecordRepository.findByTaskId(pool, 'D-174735'), null);
});

test('unknown fields and a missing pageUrl are rejected with 400', { skip: skipReason }, async (t) => {
  const { base, cookie } = await seedAndLogin(t);

  const unknown = await request(
    base,
    'POST',
    '/api/qa-records',
    saveBody({ reviewer: 'someone' }),
    cookieHeader(cookie)
  );
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error, 'validation_error');

  const noUrl = await request(base, 'POST', '/api/qa-records', saveBody({ pageUrl: '' }), cookieHeader(cookie));
  assert.equal(noUrl.status, 400);
  assert.equal((await noUrl.json()).error, 'validation_error');

  // An empty note is allowed and stored as NULL (D12 says it is optional).
  const noNote = await request(
    base,
    'POST',
    '/api/qa-records',
    saveBody({ taskId: 'D-100001', note: '' }),
    cookieHeader(cookie)
  );
  assert.equal(noNote.status, 201);
  assert.equal((await noNote.json()).record.note, null);
});

// F2 acceptance: the record is created only by pressing the button, never by
// running the tool — so index.html must post to the endpoint from exactly
// one place, the save handler behind the "Guardar QA" button.
test('index.html saves only through the Guardar QA button', () => {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

  assert.match(html, /id="save-task-id"/);
  assert.match(html, /id="save-qa-note"/);
  assert.match(html, /id="save-qa-button"/);
  assert.match(html, /onclick="saveQaRecord\(\)"/);
  assert.match(html, /Guardar QA/);

  const posts = html.match(/fetch\("\/api\/qa-records"/g) ?? [];
  assert.equal(posts.length, 1, 'only saveQaRecord may POST to /api/qa-records');
  assert.match(html, /async function saveQaRecord/);
});
