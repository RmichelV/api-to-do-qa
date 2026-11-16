import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import * as userRepository from '../src/repositories/userRepository.js';
import * as qaRecordRepository from '../src/repositories/qaRecordRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';
import { requireRole } from '../src/middleware/requireRole.js';

// PLAN F4 — the QA Shadow role gate and its side effect (D6 and D9).
//
//   1. /shadow.html is qa_shadow-only: anonymous 302, every other role 403
//      even typing the URL, qa_shadow 200.
//   2. The API guard requireRole('qa_shadow') — the one F5 mounts on the
//      Shadow routes — answers 403 JSON without the role and calls next()
//      with it.
//   3. A role change takes effect on the NEXT request, without re-login:
//      the session cookie is untouched and sessionMiddleware reads the role
//      from users on every request.
//   4. D9: removing the role releases that reviewer's OPEN work in the same
//      transaction — reviewer_id, checklist, qa_comment and qa_status back
//      to NULL and their source='manual' bugs deleted. Closed reviews and
//      other reviewers' work are never touched.
//
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
const ADMIN_EMAIL = 'shadow-admin@example.com';
const ADMIN_PASSWORD = 'shadow admin password 1';

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
    // qa_records references users (RESTRICT): children first (FK-safe order).
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
    fullName: 'Shadow Admin',
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

async function setRole(base, cookie, userId, role) {
  const response = await request(
    base,
    'PATCH',
    `/api/admin/users/${userId}`,
    { role },
    cookieHeader(cookie)
  );
  assert.equal(response.status, 200, `PATCH role ${role}`);
  assert.equal((await response.json()).user.role, role);
}

function getPage(base, path, cookie) {
  return fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: `qa_session=${cookie}` } : {},
    redirect: 'manual',
  });
}

async function seedRecord(
  pool,
  { taskId, ownerId, reviewerId = null, closedAt = null, closedBy = null, checklist = null, qaComment = null, qaStatus = null }
) {
  const id = randomUUID();
  await qaRecordRepository.insert(pool, {
    id,
    taskId,
    ownerId,
    pageUrl: 'https://example.com/inventory/',
    summary: { version: 1, checks: {} },
    reviewerId,
    closedAt,
    closedBy,
    checklist,
    qaComment,
    qaStatus,
  });
  return id;
}

async function reviewColumns(pool, id) {
  const [[row]] = await pool.execute(
    'SELECT reviewer_id, checklist, qa_comment, qa_status, closed_at FROM qa_records WHERE id = ?',
    [id]
  );
  return row;
}

async function bugSources(pool, recordId) {
  const [rows] = await pool.execute(
    'SELECT bug_id, source FROM qa_record_bugs WHERE record_id = ? ORDER BY id',
    [recordId]
  );
  return rows.map((row) => `${row.source}:${row.bug_id}`);
}

// mysql2 hands the JSON column back already parsed on some servers and as
// text on others (MariaDB stores it as LONGTEXT + CHECK JSON_VALID): accept
// both, exactly like fromJsonColumn in the repository.
function parseJsonColumn(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

// ---------------------------------------------------------------------
// 1. The page.
// ---------------------------------------------------------------------

test('/shadow.html is qa_shadow-only: 302 anonymous, 403 for every other role', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  await seedUser(pool, {
    email: 'shadow-engineer@example.com',
    password: 'shadow engineer password 1',
  });
  await seedUser(pool, {
    email: 'shadow-user@example.com',
    password: 'shadow user password 1',
    role: 'qa_shadow',
  });

  const anonymous = await getPage(base, '/shadow.html', null);
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get('location'), '/login.html');

  const engineerCookie = await loginAs(base, 'shadow-engineer@example.com', 'shadow engineer password 1');
  const asEngineer = await getPage(base, '/shadow.html', engineerCookie);
  assert.equal(asEngineer.status, 403, 'a qa_engineer must not open the Shadow page');
  assert.match(await asEngineer.text(), /qa_shadow/i, 'the 403 must name the required role');

  // The Admin assigns the role to someone else; without it, they get 403 too.
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const asAdmin = await getPage(base, '/shadow.html', adminCookie);
  assert.equal(asAdmin.status, 403, 'admin without qa_shadow must not open the Shadow page');

  const shadowCookie = await loginAs(base, 'shadow-user@example.com', 'shadow user password 1');
  const asShadow = await getPage(base, '/shadow.html', shadowCookie);
  assert.equal(asShadow.status, 200);
  assert.match(await asShadow.text(), /QA Shadow/);

  // The rest of the tool is untouched by the new gate.
  const index = await getPage(base, '/index.html', engineerCookie);
  assert.equal(index.status, 200, 'the gate only covers /shadow.html');
});

// ---------------------------------------------------------------------
// 2. The API guard F5 mounts on the Shadow routes.
// ---------------------------------------------------------------------

test('requireRole("qa_shadow") answers 403 for every other role and calls next() with it', async () => {
  // The real middleware, through a real HTTP server: this is the contract
  // the F5 Shadow routes inherit from app.js (§6 step 9 pattern). The
  // header plays the role sessionMiddleware would attach; with no session
  // at all requireRole keeps its own default deny (401, before 403).
  const app = express();
  app.use((req, res, next) => {
    req.user = req.headers['x-user-role'] ? { role: req.headers['x-user-role'] } : undefined;
    next();
  });
  app.use('/api/shadow-probe', requireRole('qa_shadow'), (req, res) => {
    res.json({ ok: true, role: req.user.role });
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const noSession = await fetch(`${base}/api/shadow-probe`);
    assert.equal(noSession.status, 401);
    assert.equal((await noSession.json()).error, 'unauthenticated');

    for (const role of ['qa_engineer', 'admin']) {
      const other = await fetch(`${base}/api/shadow-probe`, { headers: { 'x-user-role': role } });
      assert.equal(other.status, 403, `${role} must be refused`);
      assert.equal((await other.json()).error, 'forbidden');
    }

    const withRole = await fetch(`${base}/api/shadow-probe`, { headers: { 'x-user-role': 'qa_shadow' } });
    assert.equal(withRole.status, 200);
    assert.deepEqual(await withRole.json(), { ok: true, role: 'qa_shadow' });
  } finally {
    server.close();
    await once(server, 'close');
  }
});

// ---------------------------------------------------------------------
// 3. The change applies on the next request, without re-login.
// ---------------------------------------------------------------------

test('the role change applies on the next request, with the same session cookie', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const userId = await seedUser(pool, {
    email: 'next-request@example.com',
    password: 'next request password 1',
    role: 'qa_engineer',
  });
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const userCookie = await loginAs(base, 'next-request@example.com', 'next request password 1');

  const denied = await getPage(base, '/shadow.html', userCookie);
  assert.equal(denied.status, 403);

  await setRole(base, adminCookie, userId, 'qa_shadow');

  // Same cookie, no re-login: the very next request already sees the role.
  const allowed = await getPage(base, '/shadow.html', userCookie);
  assert.equal(allowed.status, 200, 'the new role must apply on the next request');
  const me = await request(base, 'GET', '/api/auth/me', undefined, cookieHeader(userCookie));
  assert.equal(me.status, 200, 'the session itself must survive the role change');
  assert.equal((await me.json()).user.role, 'qa_shadow');

  await setRole(base, adminCookie, userId, 'qa_engineer');

  const deniedAgain = await getPage(base, '/shadow.html', userCookie);
  assert.equal(deniedAgain.status, 403, 'losing the role must also apply immediately');
  assert.match(await deniedAgain.text(), /qa_shadow/i);
});

// ---------------------------------------------------------------------
// 4. D9: dropping the role releases the reviewer's open work.
// ---------------------------------------------------------------------

test('D9: removing qa_shadow releases open reviews and keeps closed and foreign ones', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  const ownerId = await seedUser(pool, {
    email: 'd9-owner@example.com',
    password: 'd9 owner password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'd9-shadow@example.com',
    password: 'd9 shadow password 1',
    role: 'qa_shadow',
  });
  const otherShadowId = await seedUser(pool, {
    email: 'd9-other-shadow@example.com',
    password: 'd9 other password 1',
    role: 'qa_shadow',
  });

  const openReview = {
    checklist: { 'OPP-01': 'bug', 'FAIL-01': 'passed' },
    qaComment: 'M / Styling / Failed / Croppe Images',
    qaStatus: 'Failed',
  };

  // The reviewer's OPEN work: review fields filled, one manual mark and one
  // tool finding on the same record.
  const openId = await seedRecord(pool, {
    taskId: 'D-900001',
    ownerId,
    reviewerId: shadowId,
    ...openReview,
  });
  await qaRecordRepository.insertBugs(pool, openId, [
    { bugId: 'FAIL-06', source: 'tool', device: 'D', type: 'Links', severity: 'Failed', description: '404 old page' },
    { bugId: 'OPP-01', source: 'manual', device: 'M/D', type: 'Styling', severity: 'Opportunity', description: 'Margins' },
  ]);

  // A second open review, no bugs: only the four columns move.
  const openBareId = await seedRecord(pool, {
    taskId: 'D-900002',
    ownerId,
    reviewerId: shadowId,
    ...openReview,
  });

  // The same reviewer's CLOSED review: history, never touched.
  const closedId = await seedRecord(pool, {
    taskId: 'D-900003',
    ownerId,
    reviewerId: shadowId,
    closedAt: new Date(),
    closedBy: shadowId,
    ...openReview,
  });
  await qaRecordRepository.insertBugs(pool, closedId, [
    { bugId: 'OPP-01', source: 'manual', device: 'M/D', type: 'Styling', severity: 'Opportunity', description: 'Margins' },
  ]);

  // Another Shadow's open review: not this role change's business.
  const foreignId = await seedRecord(pool, {
    taskId: 'D-900004',
    ownerId,
    reviewerId: otherShadowId,
    ...openReview,
  });
  await qaRecordRepository.insertBugs(pool, foreignId, [
    { bugId: 'OPP-01', source: 'manual', device: 'M/D', type: 'Styling', severity: 'Opportunity', description: 'Margins' },
  ]);

  // An untouched pending record (nobody took it yet).
  const pendingId = await seedRecord(pool, { taskId: 'D-900005', ownerId });

  await setRole(base, adminCookie, shadowId, 'qa_engineer');
  const [[after]] = await pool.execute('SELECT role FROM users WHERE id = ?', [shadowId]);
  assert.equal(after.role, 'qa_engineer');

  // The open review is back to pending: the four columns are NULL.
  for (const [label, id] of [
    ['open with bugs', openId],
    ['open without bugs', openBareId],
  ]) {
    const row = await reviewColumns(pool, id);
    assert.equal(row.reviewer_id, null, `${label}: reviewer_id`);
    assert.equal(row.checklist, null, `${label}: checklist`);
    assert.equal(row.qa_comment, null, `${label}: qa_comment`);
    assert.equal(row.qa_status, null, `${label}: qa_status`);
    assert.equal(row.closed_at, null, `${label}: still open`);
  }
  // The tool's finding survives, the manual mark is gone (D9).
  assert.deepEqual(await bugSources(pool, openId), ['tool:FAIL-06']);
  assert.deepEqual(await bugSources(pool, openBareId), []);

  // The closed review is intact: columns, closure and its manual bug.
  const closedRow = await reviewColumns(pool, closedId);
  assert.equal(closedRow.reviewer_id, shadowId);
  assert.deepEqual(parseJsonColumn(closedRow.checklist), openReview.checklist);
  assert.equal(closedRow.qa_comment, openReview.qaComment);
  assert.equal(closedRow.qa_status, openReview.qaStatus);
  assert.ok(closedRow.closed_at, 'the closed_at timestamp must stay');
  assert.deepEqual(await bugSources(pool, closedId), ['manual:OPP-01']);

  // The other Shadow's open review is untouched.
  const foreignRow = await reviewColumns(pool, foreignId);
  assert.equal(foreignRow.reviewer_id, otherShadowId);
  assert.deepEqual(parseJsonColumn(foreignRow.checklist), openReview.checklist);
  assert.equal(foreignRow.qa_comment, openReview.qaComment);
  assert.equal(foreignRow.qa_status, openReview.qaStatus);
  assert.deepEqual(await bugSources(pool, foreignId), ['manual:OPP-01']);

  // A record nobody took is still pending and unchanged.
  const pendingRow = await reviewColumns(pool, pendingId);
  assert.equal(pendingRow.reviewer_id, null);
  assert.equal(pendingRow.checklist, null);
  assert.deepEqual(await bugSources(pool, pendingId), []);
});

test('D9 only fires on role removal: assigning the role or editing the name changes nothing', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const ownerId = await seedUser(pool, {
    email: 'd9b-owner@example.com',
    password: 'd9b owner password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'd9b-shadow@example.com',
    password: 'd9b shadow password 1',
    role: 'qa_shadow',
  });

  const recordId = await seedRecord(pool, {
    taskId: 'D-910001',
    ownerId,
    reviewerId: shadowId,
    checklist: { 'OPP-01': 'bug' },
    qaComment: 'M / Styling / Failed / Croppe Images',
    qaStatus: 'Failed',
  });
  await qaRecordRepository.insertBugs(pool, recordId, [
    { bugId: 'OPP-01', source: 'manual', device: 'M/D', type: 'Styling', severity: 'Opportunity', description: 'Margins' },
  ]);

  // Same role again (the screen sends the value it already has).
  await setRole(base, adminCookie, shadowId, 'qa_shadow');
  // A rename never touches the role column.
  const renamed = await request(
    base,
    'PATCH',
    `/api/admin/users/${shadowId}`,
    { fullName: 'Renamed Shadow' },
    cookieHeader(adminCookie)
  );
  assert.equal(renamed.status, 200);

  const row = await reviewColumns(pool, recordId);
  assert.equal(row.reviewer_id, shadowId, 'nothing may be released while they keep the role');
  assert.deepEqual(parseJsonColumn(row.checklist), { 'OPP-01': 'bug' });
  assert.equal(row.qa_comment, 'M / Styling / Failed / Croppe Images');
  assert.equal(row.qa_status, 'Failed');
  assert.deepEqual(await bugSources(pool, recordId), ['manual:OPP-01']);
});
