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
// PLAN F5 — the Shadow review queue and the closure (server part only).
//
//   5. The five Shadow routes are qa_shadow-only (401 anonymous, 403 for
//      qa_engineer and admin) and keep POST /, GET /mine and PATCH /:id
//      without a role guard (D5).
//   6. The pending queue and its Task ID search hold other people's OPEN
//      QAs only: never the Shadow's own (D5), never a closed one (D14),
//      never one another Shadow took (D10).
//   7. The history holds only the QAs this Shadow closed, searchable by
//      Task ID (D14).
//   8. Taking is atomic: the first Shadow wins, the second gets 409, and
//      only the taker can save progress or close (D10).
//   9. Closing computes the status (D21, D25) and the comment (D20) from
//      the server-side BUGS.md catalog (D7), stores the closing Shadow
//      (D6) and locks every later edit (D10).
//  10. D34: deactivating a qa_shadow releases their open reviews too.
//  11. updateTaskId only touches open rows of their owner (atomic guard).
//  12. D26/D27: a tool finding may be marked N/A with an optional
//      explanation. The marks travel inside the checklist JSON column
//      (`_na`, no migration) and the finding leaves the status, the
//      counts, the comment and the bug rows.
//  13. Invalid naFindings answer 400 before any state change — and before
//      the 409 of an already closed QA.
//  14. /shadow.js is gated with /shadow.html (the F5 screen is an asset
//      of that page, never served to another role).
//
// The screen itself has no DOM test harness here: public/shadow.js is
// covered by the server contract above and by the manual F5 check.
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
  {
    taskId,
    ownerId,
    reviewerId = null,
    closedAt = null,
    closedBy = null,
    checklist = null,
    qaComment = null,
    qaStatus = null,
    summary = { version: 1, checks: {} },
    note = null,
  }
) {
  const id = randomUUID();
  await qaRecordRepository.insert(pool, {
    id,
    taskId,
    ownerId,
    pageUrl: 'https://example.com/inventory/',
    noteForShadow: note,
    summary,
    reviewerId,
    closedAt,
    closedBy,
    checklist,
    qaComment,
    qaStatus,
  });
  return id;
}

// The manual checklist of PLAN F0 (D19): the bugs the tool does NOT check.
// Mirrored here on purpose — the tests pin the exact list the server must
// enforce (D24: every item closed before continuing, D15: only BUGS.md
// items, never the "QA Todo List" of index.html).
const MANUAL_ITEMS = [
  'OPP-01', 'OPP-02', 'FAIL-01', 'FAIL-11', 'FAIL-12', 'FAIL-13',
  'FAIL-14', 'FAIL-15', 'FAIL-16', 'FAIL-17', 'CRIT-02', 'CRIT-03',
];

function fullChecklist(value = 'passed') {
  return Object.fromEntries(MANUAL_ITEMS.map((id) => [id, value]));
}

async function recordRow(pool, id) {
  const [[row]] = await pool.execute('SELECT * FROM qa_records WHERE id = ?', [id]);
  return row;
}

async function bugRows(pool, recordId) {
  const [rows] = await pool.execute(
    'SELECT bug_id, source, device, type, severity, description FROM qa_record_bugs WHERE record_id = ? ORDER BY id',
    [recordId]
  );
  return rows;
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

test('/shadow.html and /shadow.js are qa_shadow-only: 302 anonymous, 403 for every other role', { skip: skipReason }, async (t) => {
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

  // The script of that page is gated exactly like the page: without the
  // role it is a page asset, so it never ships to another role (F5).
  const scriptAnonymous = await getPage(base, '/shadow.js', null);
  assert.equal(scriptAnonymous.status, 302);
  assert.equal(scriptAnonymous.headers.get('location'), '/login.html');

  const scriptEngineer = await getPage(base, '/shadow.js', engineerCookie);
  assert.equal(scriptEngineer.status, 403, 'a qa_engineer must not read /shadow.js');
  const scriptAdmin = await getPage(base, '/shadow.js', adminCookie);
  assert.equal(scriptAdmin.status, 403);

  const scriptShadow = await getPage(base, '/shadow.js', shadowCookie);
  assert.equal(scriptShadow.status, 200);

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

// ---------------------------------------------------------------------
// 5. F5 — the five Shadow routes and their role guard.
// ---------------------------------------------------------------------

test('F5: the Shadow routes answer 401 anonymously and 403 without qa_shadow', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-gate-engineer@example.com',
    password: 'f5 gate engineer password 1',
  });
  await seedUser(pool, {
    email: 'f5-gate-shadow@example.com',
    password: 'f5 gate shadow password 1',
    role: 'qa_shadow',
  });
  const recordId = await seedRecord(pool, { taskId: 'D-500001', ownerId: engineerId });

  // Anonymous: default deny before any role check.
  const anonymous = await request(base, 'GET', '/api/qa-records');
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, 'unauthenticated');

  const engineerCookie = await loginAs(base, 'f5-gate-engineer@example.com', 'f5 gate engineer password 1');
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const shadowCookie = await loginAs(base, 'f5-gate-shadow@example.com', 'f5 gate shadow password 1');

  // Every F5 route refuses the other roles before touching the handler.
  const endpoints = [
    ['GET', '/api/qa-records', undefined],
    ['GET', '/api/qa-records/history', undefined],
    ['POST', `/api/qa-records/${recordId}/take`, {}],
    ['PATCH', `/api/qa-records/${recordId}/review`, {}],
    ['POST', `/api/qa-records/${recordId}/close`, {}],
  ];
  for (const [method, path, body] of endpoints) {
    for (const [label, cookie] of [['qa_engineer', engineerCookie], ['admin', adminCookie]]) {
      const response = await request(base, method, path, body, cookieHeader(cookie));
      assert.equal(response.status, 403, `${method} ${path} must refuse ${label}`);
      assert.equal((await response.json()).error, 'forbidden', `${method} ${path} (${label})`);
    }
  }

  // With the role the guard calls next(): queue and history answer 200 and
  // taking an untouched QA succeeds.
  const pending = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadowCookie));
  assert.equal(pending.status, 200);
  const history = await request(base, 'GET', '/api/qa-records/history', undefined, cookieHeader(shadowCookie));
  assert.equal(history.status, 200);
  const take = await request(base, 'POST', `/api/qa-records/${recordId}/take`, {}, cookieHeader(shadowCookie));
  assert.equal(take.status, 200);

  // D5 stays intact: the routes without a role guard still work for anyone
  // with a session (POST / saves, GET /mine lists the own records).
  const mine = await request(base, 'GET', '/api/qa-records/mine', undefined, cookieHeader(engineerCookie));
  assert.equal(mine.status, 200, 'GET /mine must keep having no role guard (D5)');
});

// ---------------------------------------------------------------------
// 6. F5 — the pending queue and its Task ID search (D5, D10, D14).
// ---------------------------------------------------------------------

test('F5: the pending queue holds other people\'s open QAs only, searchable by Task ID', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-queue-engineer@example.com',
    password: 'f5 queue password 1',
    fullName: 'Queue Owner',
  });
  const shadow1Id = await seedUser(pool, {
    email: 'f5-queue-shadow1@example.com',
    password: 'f5 queue password 1',
    role: 'qa_shadow',
  });
  const shadow2Id = await seedUser(pool, {
    email: 'f5-queue-shadow2@example.com',
    password: 'f5 queue password 1',
    role: 'qa_shadow',
  });

  // A: open, someone else's, untouched — the normal queue entry.
  await seedRecord(pool, {
    taskId: 'D-510001',
    ownerId: engineerId,
    note: 'Check the hero image before judging it',
    summary: { version: 1, checks: { h1: { status: 'pass', result: 'There is only one visible H1' } } },
  });
  // B: open but taken by the other Shadow (D10: out of everyone else's queue).
  await seedRecord(pool, { taskId: 'D-510002', ownerId: engineerId, reviewerId: shadow2Id });
  // C: saved by this very Shadow (D5: never in their own queue).
  await seedRecord(pool, { taskId: 'D-510003', ownerId: shadow1Id });
  // D: closed (D14: closed QAs leave every queue, whoever closed them).
  await seedRecord(pool, {
    taskId: 'D-510004',
    ownerId: engineerId,
    reviewerId: shadow2Id,
    closedAt: new Date(),
    closedBy: shadow2Id,
  });

  const shadow1Cookie = await loginAs(base, 'f5-queue-shadow1@example.com', 'f5 queue password 1');
  const shadow2Cookie = await loginAs(base, 'f5-queue-shadow2@example.com', 'f5 queue password 1');

  const first = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadow1Cookie));
  assert.equal(first.status, 200);
  let body = await first.json();
  assert.deepEqual(
    body.records.map((record) => record.taskId),
    ['D-510001'],
    'only the untouched QA of somebody else belongs to the queue'
  );
  assert.equal(body.records[0].ownerId, engineerId, 'the queue carries the owner (D6)');
  assert.equal(body.records[0].ownerFullName, 'Queue Owner');
  assert.equal(body.records[0].note, 'Check the hero image before judging it', 'the engineer\'s note is shown (D12)');
  assert.ok(body.records[0].summary, 'the Shadow reads the saved summary without re-running the tool');

  // The other Shadow keeps their taken QA visible to themselves (D10) and
  // sees the untouched ones — but never their closed one nor their own.
  const second = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadow2Cookie));
  body = await second.json();
  assert.deepEqual(
    body.records.map((record) => record.taskId).sort(),
    ['D-510001', 'D-510002', 'D-510003']
  );

  // Search: exact Task ID, case-insensitive (stored uppercase).
  const found = await request(base, 'GET', '/api/qa-records?taskId=d-510001', undefined, cookieHeader(shadow1Cookie));
  assert.equal(found.status, 200);
  assert.deepEqual((await found.json()).records.map((record) => record.taskId), ['D-510001']);
  for (const taskId of ['D-510002', 'D-510003', 'D-510004', 'D-599999']) {
    const response = await request(base, 'GET', `/api/qa-records?taskId=${taskId}`, undefined, cookieHeader(shadow1Cookie));
    assert.deepEqual((await response.json()).records, [], `${taskId} must not be returned to shadow1`);
  }
  const malformed = await request(base, 'GET', '/api/qa-records?taskId=nope', undefined, cookieHeader(shadow1Cookie));
  assert.equal(malformed.status, 400, 'a malformed Task ID is a validation error');
  assert.equal((await malformed.json()).error, 'validation_error');
});

// ---------------------------------------------------------------------
// 7. F5 — the reviewer's history (D14).
// ---------------------------------------------------------------------

test('F5: the history holds only the QAs this Shadow closed, searchable by Task ID', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-history-engineer@example.com',
    password: 'f5 history password 1',
  });
  const shadow1Id = await seedUser(pool, {
    email: 'f5-history-shadow1@example.com',
    password: 'f5 history password 1',
    role: 'qa_shadow',
  });
  const shadow2Id = await seedUser(pool, {
    email: 'f5-history-shadow2@example.com',
    password: 'f5 history password 1',
    role: 'qa_shadow',
  });

  const closedChecklist = { 'OPP-01': 'passed', 'FAIL-01': 'bug' };
  // E: closed by this Shadow.
  const closedId = await seedRecord(pool, {
    taskId: 'D-520001',
    ownerId: engineerId,
    reviewerId: shadow1Id,
    checklist: closedChecklist,
    qaStatus: 'Failed',
    qaComment: 'M/D / Styling / Failed / Cropped images',
    closedAt: new Date(),
    closedBy: shadow1Id,
  });
  // F: closed by the other Shadow.
  await seedRecord(pool, {
    taskId: 'D-520002',
    ownerId: engineerId,
    reviewerId: shadow2Id,
    qaStatus: 'Passed',
    closedAt: new Date(),
    closedBy: shadow2Id,
  });
  // G: open and taken by this Shadow — work in progress, not history.
  await seedRecord(pool, { taskId: 'D-520003', ownerId: engineerId, reviewerId: shadow1Id });

  const shadow1Cookie = await loginAs(base, 'f5-history-shadow1@example.com', 'f5 history password 1');

  const history = await request(base, 'GET', '/api/qa-records/history', undefined, cookieHeader(shadow1Cookie));
  assert.equal(history.status, 200);
  let body = await history.json();
  assert.deepEqual(
    body.records.map((record) => record.taskId),
    ['D-520001'],
    'only the QAs this Shadow closed belong to their history'
  );
  const entry = body.records[0];
  assert.equal(entry.id, closedId);
  assert.equal(entry.qaStatus, 'Failed');
  assert.equal(entry.qaComment, 'M/D / Styling / Failed / Cropped images');
  assert.deepEqual(parseJsonColumn(entry.checklist), closedChecklist);
  assert.ok(entry.closedAt, 'the history shows when it was closed');

  const found = await request(base, 'GET', '/api/qa-records/history?taskId=D-520001', undefined, cookieHeader(shadow1Cookie));
  assert.deepEqual((await found.json()).records.map((record) => record.taskId), ['D-520001']);
  const foreign = await request(base, 'GET', '/api/qa-records/history?taskId=D-520002', undefined, cookieHeader(shadow1Cookie));
  assert.deepEqual((await foreign.json()).records, [], 'another Shadow\'s closure is not in my history');
  const open = await request(base, 'GET', '/api/qa-records/history?taskId=D-520003', undefined, cookieHeader(shadow1Cookie));
  assert.deepEqual((await open.json()).records, [], 'an open review is not history yet');
});

// ---------------------------------------------------------------------
// 8. F5 — "Tomar": the atomic claim (D10).
// ---------------------------------------------------------------------

test('F5: taking is atomic — the first Shadow wins, the second gets 409 (D10)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-take-engineer@example.com',
    password: 'f5 take password 1',
  });
  const shadow1Id = await seedUser(pool, {
    email: 'f5-take-shadow1@example.com',
    password: 'f5 take password 1',
    role: 'qa_shadow',
  });
  const shadow2Id = await seedUser(pool, {
    email: 'f5-take-shadow2@example.com',
    password: 'f5 take password 1',
    role: 'qa_shadow',
  });

  const recordId = await seedRecord(pool, { taskId: 'D-530001', ownerId: engineerId });
  const ownId = await seedRecord(pool, { taskId: 'D-530002', ownerId: shadow2Id });
  const closedId = await seedRecord(pool, {
    taskId: 'D-530003',
    ownerId: engineerId,
    reviewerId: shadow2Id,
    closedAt: new Date(),
    closedBy: shadow2Id,
  });

  const shadow1Cookie = await loginAs(base, 'f5-take-shadow1@example.com', 'f5 take password 1');
  const shadow2Cookie = await loginAs(base, 'f5-take-shadow2@example.com', 'f5 take password 1');

  const first = await request(base, 'POST', `/api/qa-records/${recordId}/take`, {}, cookieHeader(shadow1Cookie));
  assert.equal(first.status, 200);
  assert.equal((await first.json()).record.reviewerId, shadow1Id);
  const taken = await recordRow(pool, recordId);
  assert.equal(taken.reviewer_id, shadow1Id, 'the claim must be stored');

  // The second Shadow is refused: the WHERE reviewer_id IS NULL matched0.
  const second = await request(base, 'POST', `/api/qa-records/${recordId}/take`, {}, cookieHeader(shadow2Cookie));
  assert.equal(second.status, 409);
  assert.equal((await second.json()).error, 'already_taken');

  // Taking again changes nothing (idempotent for the taker).
  const again = await request(base, 'POST', `/api/qa-records/${recordId}/take`, {}, cookieHeader(shadow1Cookie));
  assert.equal(again.status, 200);
  assert.equal((await recordRow(pool, recordId)).reviewer_id, shadow1Id);

  // The taken QA left the other Shadow's queue and stayed in the taker's;
  // the other Shadow's OWN record (D-530002) is pending for everyone else,
  // and the closed one (D-530003) is out of every queue (D14).
  const secondQueue = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadow2Cookie));
  assert.deepEqual((await secondQueue.json()).records, []);
  const firstQueue = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadow1Cookie));
  assert.deepEqual(
    (await firstQueue.json()).records.map((record) => record.taskId).sort(),
    ['D-530001', 'D-530002']
  );

  // D5: a Shadow never reviews their own QA.
  const own = await request(base, 'POST', `/api/qa-records/${ownId}/take`, {}, cookieHeader(shadow2Cookie));
  assert.equal(own.status, 403);
  assert.equal((await own.json()).error, 'forbidden');

  // A closed QA can never be claimed.
  const closed = await request(base, 'POST', `/api/qa-records/${closedId}/take`, {}, cookieHeader(shadow1Cookie));
  assert.equal(closed.status, 409);
  assert.equal((await closed.json()).error, 'record_closed');

  // Unknown id answers 404 without leaking anything.
  const missing = await request(base, 'POST', '/api/qa-records/00000000-0000-0000-0000-000000000000/take', {}, cookieHeader(shadow1Cookie));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_found');
});

// ---------------------------------------------------------------------
// 9. F5 — "Guardar avance": save the review without closing it.
// ---------------------------------------------------------------------

test('F5: only the reviewer who took the QA can save progress, while it stays open', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-save-engineer@example.com',
    password: 'f5 save password 1',
  });
  const shadow1Id = await seedUser(pool, {
    email: 'f5-save-shadow1@example.com',
    password: 'f5 save password 1',
    role: 'qa_shadow',
  });
  const shadow2Id = await seedUser(pool, {
    email: 'f5-save-shadow2@example.com',
    password: 'f5 save password 1',
    role: 'qa_shadow',
  });

  const untakenId = await seedRecord(pool, { taskId: 'D-535001', ownerId: engineerId });
  const takenByOtherId = await seedRecord(pool, { taskId: 'D-535002', ownerId: engineerId, reviewerId: shadow2Id });
  const ownId = await seedRecord(pool, { taskId: 'D-535003', ownerId: shadow1Id });
  const closedId = await seedRecord(pool, {
    taskId: 'D-535004',
    ownerId: engineerId,
    reviewerId: shadow1Id,
    closedAt: new Date(),
    closedBy: shadow1Id,
  });
  const mineId = await seedRecord(pool, { taskId: 'D-535005', ownerId: engineerId, reviewerId: shadow1Id });

  const shadow1Cookie = await loginAs(base, 'f5-save-shadow1@example.com', 'f5 save password 1');
  // A VALID save payload: validation runs before the state guard, so a
  // malformed body is a 400 whatever the record's state is — these probes
  // must reach the guard to prove the 409/403 answers.
  const probe = { checklist: { 'OPP-01': 'passed' } };

  // Nobody took it yet → 409, the Shadow must press "Tomar" first.
  const untaken = await request(
    base, 'PATCH', `/api/qa-records/${untakenId}/review`,
    probe, cookieHeader(shadow1Cookie)
  );
  assert.equal(untaken.status, 409);
  assert.equal((await untaken.json()).error, 'not_taken');

  // Another Shadow took it → 403 (only the taker can edit, D10).
  const foreign = await request(
    base, 'PATCH', `/api/qa-records/${takenByOtherId}/review`,
    probe, cookieHeader(shadow1Cookie)
  );
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error, 'forbidden');

  // Own QA → 403 (D5), taken or not.
  const ownTake = await request(base, 'POST', `/api/qa-records/${ownId}/take`, {}, cookieHeader(shadow1Cookie));
  assert.equal(ownTake.status, 403);
  const ownSave = await request(
    base, 'PATCH', `/api/qa-records/${ownId}/review`,
    probe, cookieHeader(shadow1Cookie)
  );
  assert.equal(ownSave.status, 403);

  // A closed QA can never be edited again.
  const closedSave = await request(
    base, 'PATCH', `/api/qa-records/${closedId}/review`,
    probe, cookieHeader(shadow1Cookie)
  );
  assert.equal(closedSave.status, 409);
  assert.equal((await closedSave.json()).error, 'record_closed');

  // The checklist only accepts the manual items of BUGS.md (D15).
  const unknownItem = await request(
    base, 'PATCH', `/api/qa-records/${mineId}/review`,
    { checklist: { 'FAIL-99': 'passed' } }, cookieHeader(shadow1Cookie)
  );
  assert.equal(unknownItem.status, 400);
  assert.equal((await unknownItem.json()).error, 'validation_error');

  const badValue = await request(
    base, 'PATCH', `/api/qa-records/${mineId}/review`,
    { checklist: { 'OPP-01': 'yes' } }, cookieHeader(shadow1Cookie)
  );
  assert.equal(badValue.status, 400);

  // D21: every item marked as Bug carries the device the Shadow picked.
  const missingDevice = await request(
    base, 'PATCH', `/api/qa-records/${mineId}/review`,
    { checklist: { 'OPP-01': 'bug' } }, cookieHeader(shadow1Cookie)
  );
  assert.equal(missingDevice.status, 400);

  const unknownField = await request(
    base, 'PATCH', `/api/qa-records/${mineId}/review`,
    { checklist: { 'OPP-01': 'passed' }, qaLink: 'https://example.com' }, cookieHeader(shadow1Cookie)
  );
  assert.equal(unknownField.status, 400, 'no QA Link exists (D2)');

  // A valid partial save: stored with the reviewer's name, still open, and
  // the manual mark becomes a qa_record_bugs row (source='manual', D9).
  const saved = await request(
    base, 'PATCH', `/api/qa-records/${mineId}/review`,
    {
      checklist: { 'OPP-01': 'bug', 'FAIL-01': 'passed' },
      bugDevices: { 'OPP-01': 'M/D' },
      qaStatus: 'In review',
    },
    cookieHeader(shadow1Cookie)
  );
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.deepEqual(parseJsonColumn(body.record.checklist), { 'OPP-01': 'bug', 'FAIL-01': 'passed' });
  assert.equal(body.record.qaStatus, 'In review');

  const row = await recordRow(pool, mineId);
  assert.equal(row.reviewer_id, shadow1Id);
  assert.equal(row.closed_at, null, 'saving progress must not close the QA');
  assert.equal(row.qa_status, 'In review');
  assert.deepEqual(parseJsonColumn(row.checklist), { 'OPP-01': 'bug', 'FAIL-01': 'passed' });
  assert.deepEqual(await bugRows(pool, mineId), [
    {
      bug_id: 'OPP-01',
      source: 'manual',
      device: 'M/D',
      type: 'Styling',
      severity: 'Opportunity',
      description: 'Margins and paddings',
    },
  ]);
});

// ---------------------------------------------------------------------
// 10. F5 — "Cerrar QA": status (D21/D25) and comment (D20) from the catalog.
// ---------------------------------------------------------------------

test('F5: closing a QA without bugs stores Passed and no comment (D25)', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-close-clean-engineer@example.com',
    password: 'f5 close password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'f5-close-clean-shadow@example.com',
    password: 'f5 close password 1',
    role: 'qa_shadow',
  });
  const recordId = await seedRecord(pool, {
    taskId: 'D-536001',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: {
      version: 1,
      checks: { h1: { status: 'pass', result: 'There is only one visible H1', total: 1, failed: 0, items: [] } },
    },
  });

  const cookie = await loginAs(base, 'f5-close-clean-shadow@example.com', 'f5 close password 1');
  const response = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: fullChecklist('passed') }, cookieHeader(cookie)
  );
  assert.equal(response.status, 200);
  const { record } = await response.json();
  assert.equal(record.qaStatus, 'Passed');
  assert.equal(record.qaComment, null, 'no bugs means no generated comment (D25)');
  assert.equal(record.criticalCount, 0);
  assert.equal(record.failedCount, 0);
  assert.equal(record.opportunityCount, 0);
  assert.ok(record.closedAt);

  const row = await recordRow(pool, recordId);
  assert.equal(row.qa_status, 'Passed');
  assert.equal(row.qa_comment, null);
  assert.equal(row.failed_count, 0);
  assert.deepEqual(await bugRows(pool, recordId), [], 'nothing to report means no bug rows');
});

test('F5: one manual bug → its severity and a single D20 comment line', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-close-one-engineer@example.com',
    password: 'f5 close password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'f5-close-one-shadow@example.com',
    password: 'f5 close password 1',
    role: 'qa_shadow',
  });
  const recordId = await seedRecord(pool, { taskId: 'D-536002', ownerId: engineerId, reviewerId: shadowId });

  const cookie = await loginAs(base, 'f5-close-one-shadow@example.com', 'f5 close password 1');
  const checklist = fullChecklist('passed');
  checklist['FAIL-01'] = 'bug';
  const response = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist, bugDevices: { 'FAIL-01': 'M/D' } }, cookieHeader(cookie)
  );
  assert.equal(response.status, 200);
  const { record } = await response.json();
  assert.equal(record.qaStatus, 'Failed', 'a single bug gives its own severity (D21)');
  assert.equal(record.qaComment, 'M/D / Styling / Failed / Cropped images', 'D20: Device / Type / Severity / Description');
  assert.equal(record.failedCount, 1);
  assert.equal(record.criticalCount, 0);
  assert.equal(record.opportunityCount, 0);

  const row = await recordRow(pool, recordId);
  assert.equal(row.failed_count, 1);
  assert.deepEqual(await bugRows(pool, recordId), [
    {
      bug_id: 'FAIL-01',
      source: 'manual',
      device: 'M/D',
      type: 'Styling',
      severity: 'Failed',
      description: 'Cropped images',
    },
  ]);
});

test('F5: tool and manual findings → D21 counts and D20 lines from the server catalog', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-close-mixed-engineer@example.com',
    password: 'f5 close password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'f5-close-mixed-shadow@example.com',
    password: 'f5 close password 1',
    role: 'qa_shadow',
  });
  const recordId = await seedRecord(pool, {
    taskId: 'D-536003',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: {
      version: 1,
      ranAt: '2026-11-20T10:00:00.000Z',
      checks: {
        h1: { status: 'pass', result: 'There is only one visible H1', total: 1, failed: 0, items: [] },
        linkStatus: {
          status: 'fail',
          result: '120 links, 1 failed',
          total: 120,
          failed: 1,
          // Deliberately wrong type/severity: the server must take them from
          // its own BUGS.md catalog, never from what the browser sends.
          items: [
            { bugId: 'FAIL-06', type: 'Copy', severity: 'Opportunity', device: 'D', text: '404 https://example.com/old-page' },
          ],
        },
        textDesktop: {
          status: 'fail',
          result: 'INCOMPLETE — CO lines: 18, present: 15, missing: 3',
          total: 18,
          failed: 3,
          items: [
            {
              bugId: 'CRIT-01',
              type: 'Images',
              severity: 'Failed',
              device: 'D',
              text: 'INCOMPLETE — CO lines: 18, present: 15, missing: 3',
            },
          ],
        },
      },
    },
  });

  const cookie = await loginAs(base, 'f5-close-mixed-shadow@example.com', 'f5 close password 1');
  const checklist = fullChecklist('passed');
  checklist['OPP-01'] = 'bug';
  checklist['FAIL-01'] = 'bug';
  const response = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist, bugDevices: { 'OPP-01': 'M/D', 'FAIL-01': 'D' } }, cookieHeader(cookie)
  );
  assert.equal(response.status, 200);
  const { record } = await response.json();

  // D21 with more than one bug: the count per severity, in fixed order.
  assert.equal(record.qaStatus, 'Critical (1), Failed (2), Opportunity (1)');
  // D20: one line per bug, tool findings first, catalog type/severity.
  assert.equal(
    record.qaComment,
    [
      'D / Links / Failed / 404 https://example.com/old-page',
      'D / Copy / Critical / INCOMPLETE — CO lines: 18, present: 15, missing: 3',
      'M/D / Styling / Opportunity / Margins and paddings',
      'D / Styling / Failed / Cropped images',
    ].join('\n')
  );
  assert.equal(record.criticalCount, 1);
  assert.equal(record.failedCount, 2);
  assert.equal(record.opportunityCount, 1);

  const row = await recordRow(pool, recordId);
  assert.equal(row.critical_count, 1);
  assert.equal(row.failed_count, 2);
  assert.equal(row.opportunity_count, 1);
  assert.deepEqual(
    await bugSources(pool, recordId),
    ['tool:FAIL-06', 'tool:CRIT-01', 'manual:OPP-01', 'manual:FAIL-01'],
    'tool findings are stored too (source=tool), in comment order'
  );
  const [bugs] = await pool.execute(
    'SELECT type, severity FROM qa_record_bugs WHERE record_id = ? AND bug_id = ?',
    [recordId, 'FAIL-06']
  );
  assert.deepEqual(bugs[0], { type: 'Links', severity: 'Failed' }, 'the catalog wins over the browser copy');
});

test('F5: D8 lets the Shadow edit the generated status and comment before closing', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-close-edit-engineer@example.com',
    password: 'f5 close password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'f5-close-edit-shadow@example.com',
    password: 'f5 close password 1',
    role: 'qa_shadow',
  });
  const recordId = await seedRecord(pool, { taskId: 'D-536004', ownerId: engineerId, reviewerId: shadowId });

  const cookie = await loginAs(base, 'f5-close-edit-shadow@example.com', 'f5 close password 1');
  const checklist = fullChecklist('passed');
  checklist['FAIL-01'] = 'bug';
  const response = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    {
      checklist,
      bugDevices: { 'FAIL-01': 'M' },
      qaStatus: 'Passed',
      qaComment: 'Fixed with the specialist before delivery.',
    },
    cookieHeader(cookie)
  );
  assert.equal(response.status, 200);
  const { record } = await response.json();
  assert.equal(record.qaStatus, 'Passed', 'the Shadow gives the final criterion (D8)');
  assert.equal(record.qaComment, 'Fixed with the specialist before delivery.');
  assert.equal(record.failedCount, 1, 'the counts still describe the found bugs (D21)');
});

test('F5: closing requires the whole manual checklist (D24) and validates it', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-close-checklist-engineer@example.com',
    password: 'f5 close password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'f5-close-checklist-shadow@example.com',
    password: 'f5 close password 1',
    role: 'qa_shadow',
  });
  const recordId = await seedRecord(pool, { taskId: 'D-536005', ownerId: engineerId, reviewerId: shadowId });

  const cookie = await loginAs(base, 'f5-close-checklist-shadow@example.com', 'f5 close password 1');

  // Missing items: "todos tienen que estar cerrados para continuar".
  const incomplete = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: { 'OPP-01': 'passed' } }, cookieHeader(cookie)
  );
  assert.equal(incomplete.status, 400);
  assert.equal((await incomplete.json()).error, 'validation_error');

  // Unknown item: only the BUGS.md manual checklist counts (D15).
  const unknown = fullChecklist('passed');
  unknown['FAIL-99'] = 'passed';
  const withUnknown = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: unknown }, cookieHeader(cookie)
  );
  assert.equal(withUnknown.status, 400);

  // A Bug without its device is refused (D21).
  const withoutDevice = fullChecklist('passed');
  withoutDevice['CRIT-03'] = 'bug';
  const noDevice = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: withoutDevice }, cookieHeader(cookie)
  );
  assert.equal(noDevice.status, 400);

  // None of the rejected attempts touched the record.
  const row = await recordRow(pool, recordId);
  assert.equal(row.closed_at, null);
  assert.equal(row.checklist, null);
  assert.equal(row.qa_status, null);
});

// ---------------------------------------------------------------------
// 11. F5 — the closure locks the record and stores who closed it.
// ---------------------------------------------------------------------

test('F5: after closing, every later edit answers 409 and the closer is stored', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-lock-engineer@example.com',
    password: 'f5 lock password 1',
  });
  const shadow1Id = await seedUser(pool, {
    email: 'f5-lock-shadow1@example.com',
    password: 'f5 lock password 1',
    role: 'qa_shadow',
  });
  const shadow2Id = await seedUser(pool, {
    email: 'f5-lock-shadow2@example.com',
    password: 'f5 lock password 1',
    role: 'qa_shadow',
  });

  const recordId = await seedRecord(pool, { taskId: 'D-537001', ownerId: engineerId, reviewerId: shadow1Id });

  const shadow1Cookie = await loginAs(base, 'f5-lock-shadow1@example.com', 'f5 lock password 1');
  const shadow2Cookie = await loginAs(base, 'f5-lock-shadow2@example.com', 'f5 lock password 1');
  const engineerCookie = await loginAs(base, 'f5-lock-engineer@example.com', 'f5 lock password 1');

  const close = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: fullChecklist('passed') }, cookieHeader(shadow1Cookie)
  );
  assert.equal(close.status, 200);

  // D6: the record stores who closed it, as QA Shadow.
  const row = await recordRow(pool, recordId);
  assert.equal(row.reviewer_id, shadow1Id);
  assert.equal(row.closed_by, shadow1Id);
  assert.ok(row.closed_at);

  // The QA is out of every pending queue and into the closer's history.
  const pending = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadow2Cookie));
  assert.deepEqual((await pending.json()).records, []);
  const history = await request(base, 'GET', '/api/qa-records/history', undefined, cookieHeader(shadow1Cookie));
  assert.deepEqual((await history.json()).records.map((record) => record.taskId), ['D-537001']);

  // Every later edit is refused — the Shadow who closed it…
  const saveAgain = await request(
    base, 'PATCH', `/api/qa-records/${recordId}/review`,
    { checklist: { 'OPP-01': 'passed' } }, cookieHeader(shadow1Cookie)
  );
  assert.equal(saveAgain.status, 409);
  assert.equal((await saveAgain.json()).error, 'record_closed');

  const closeAgain = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: fullChecklist('passed') }, cookieHeader(shadow1Cookie)
  );
  assert.equal(closeAgain.status, 409);

  const takeAgain = await request(base, 'POST', `/api/qa-records/${recordId}/take`, {}, cookieHeader(shadow1Cookie));
  assert.equal(takeAgain.status, 409);

  // …another Shadow…
  const otherSave = await request(
    base, 'PATCH', `/api/qa-records/${recordId}/review`,
    { checklist: { 'OPP-01': 'passed' } }, cookieHeader(shadow2Cookie)
  );
  assert.equal(otherSave.status, 409, 'a closed QA answers 409 to everybody');

  // …and the Engineer who saved it (Task ID correction, F3).
  const ownerPatch = await request(
    base, 'PATCH', `/api/qa-records/${recordId}`,
    { taskId: 'D-537099' }, cookieHeader(engineerCookie)
  );
  assert.equal(ownerPatch.status, 409);
  assert.equal((await ownerPatch.json()).error, 'record_closed');
  assert.equal((await recordRow(pool, recordId)).task_id, 'D-537001', 'the rejected edit changed nothing');
});

// ---------------------------------------------------------------------
// 12. F5 — D34: deactivating a Shadow releases their open reviews too.
// ---------------------------------------------------------------------

test('D34: deactivating a qa_shadow releases their open reviews in the same transaction', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const adminCookie = await loginAs(base, ADMIN_EMAIL, ADMIN_PASSWORD);

  const ownerId = await seedUser(pool, {
    email: 'd34-owner@example.com',
    password: 'd34 owner password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'd34-shadow@example.com',
    password: 'd34 shadow password 1',
    role: 'qa_shadow',
  });
  const otherShadowId = await seedUser(pool, {
    email: 'd34-other-shadow@example.com',
    password: 'd34 other password 1',
    role: 'qa_shadow',
  });

  const openId = await seedRecord(pool, {
    taskId: 'D-920001',
    ownerId,
    reviewerId: shadowId,
    checklist: { 'OPP-01': 'bug' },
    qaComment: 'M / Styling / Failed / Margins and paddings',
    qaStatus: 'Opportunity',
  });
  await qaRecordRepository.insertBugs(pool, openId, [
    { bugId: 'FAIL-06', source: 'tool', device: 'D', type: 'Links', severity: 'Failed', description: '404 old page' },
    { bugId: 'OPP-01', source: 'manual', device: 'M', type: 'Styling', severity: 'Opportunity', description: 'Margins' },
  ]);

  const closedId = await seedRecord(pool, {
    taskId: 'D-920002',
    ownerId,
    reviewerId: shadowId,
    checklist: { 'OPP-01': 'passed' },
    qaStatus: 'Passed',
    closedAt: new Date(),
    closedBy: shadowId,
  });
  await qaRecordRepository.insertBugs(pool, closedId, [
    { bugId: 'OPP-01', source: 'manual', device: 'M', type: 'Styling', severity: 'Opportunity', description: 'Margins' },
  ]);

  const foreignId = await seedRecord(pool, {
    taskId: 'D-920003',
    ownerId,
    reviewerId: otherShadowId,
    checklist: { 'OPP-01': 'bug' },
    qaStatus: 'Opportunity',
  });

  // The Admin deactivates the account (isActive: false), keeping the role.
  const deactivate = await request(
    base,
    'PATCH',
    `/api/admin/users/${shadowId}`,
    { isActive: false },
    cookieHeader(adminCookie)
  );
  assert.equal(deactivate.status, 200);
  const deactivated = await deactivate.json();
  assert.equal(deactivated.user.isActive, false);
  assert.equal(deactivated.user.role, 'qa_shadow', 'D34 deactivates, it does not change the role');

  // The open review is released exactly like D9.
  const openRow = await reviewColumns(pool, openId);
  assert.equal(openRow.reviewer_id, null);
  assert.equal(openRow.checklist, null);
  assert.equal(openRow.qa_comment, null);
  assert.equal(openRow.qa_status, null);
  assert.equal(openRow.closed_at, null);
  assert.deepEqual(await bugSources(pool, openId), ['tool:FAIL-06'], 'manual marks go, tool findings stay');

  // The closed review and the other Shadow's work are untouched.
  const closedRow = await reviewColumns(pool, closedId);
  assert.equal(closedRow.reviewer_id, shadowId);
  assert.equal(closedRow.qa_status, 'Passed');
  assert.ok(closedRow.closed_at);
  assert.deepEqual(await bugSources(pool, closedId), ['manual:OPP-01']);

  const foreignRow = await reviewColumns(pool, foreignId);
  assert.equal(foreignRow.reviewer_id, otherShadowId);
  assert.equal(foreignRow.qa_status, 'Opportunity');
});

// ---------------------------------------------------------------------
// 13. F5 — the atomic Task ID guard (pending review from F3).
// ---------------------------------------------------------------------

test('updateTaskId only moves open rows of their own owner (atomic WHERE + affectedRows)', { skip: skipReason }, async (t) => {
  const { pool } = await startApp(t);
  const ownerId = await seedUser(pool, {
    email: 'f5-taskid-owner@example.com',
    password: 'f5 taskid password 1',
  });
  const otherId = await seedUser(pool, {
    email: 'f5-taskid-other@example.com',
    password: 'f5 taskid password 1',
  });

  const openId = await seedRecord(pool, { taskId: 'D-540001', ownerId });
  const closedId = await seedRecord(pool, {
    taskId: 'D-540002',
    ownerId,
    reviewerId: otherId,
    closedAt: new Date(),
    closedBy: otherId,
  });
  const foreignId = await seedRecord(pool, { taskId: 'D-540003', ownerId: otherId });

  const updated = await qaRecordRepository.updateTaskId(pool, openId, 'D-540009', ownerId);
  assert.equal(updated.task_id, 'D-540009', 'an open row of the owner still moves');

  const closedUpdate = await qaRecordRepository.updateTaskId(pool, closedId, 'D-540010', ownerId);
  assert.equal(closedUpdate, null, 'a closed row must not be updated even if the caller asks for it');
  assert.equal((await recordRow(pool, closedId)).task_id, 'D-540002', 'the closed row keeps its Task ID');

  const foreignUpdate = await qaRecordRepository.updateTaskId(pool, foreignId, 'D-540011', ownerId);
  assert.equal(foreignUpdate, null, 'a row of another owner must not be updated');
  assert.equal((await recordRow(pool, foreignId)).task_id, 'D-540003');
});

// ---------------------------------------------------------------------
// 14. F5 — D26/D27: a tool finding may be marked N/A, with an optional
//     explanation, and it never counts towards the closure.
// ---------------------------------------------------------------------

// Two tool findings the closure tests already know (FAIL-06 and CRIT-01)
// plus a check whose finding carries no BUGS.md id, so "one N/A", "all
// N/A" and "never countable" are all observable in the same summary.
function naSummary() {
  return {
    version: 1,
    checks: {
      h1: {
        status: 'pass',
        result: 'There is only one visible H1',
        total: 1,
        failed: 0,
        items: [{ bugId: null, device: 'D', text: 'Only one H1' }],
      },
      linkStatus: {
        status: 'fail',
        result: '120 links, 1 failed',
        total: 120,
        failed: 1,
        items: [
          { bugId: 'FAIL-06', type: 'Links', severity: 'Failed', device: 'D', text: '404 https://example.com/old-page' },
        ],
      },
      textDesktop: {
        status: 'fail',
        result: 'INCOMPLETE — CO lines: 18, present: 15, missing: 3',
        total: 18,
        failed: 3,
        items: [
          {
            bugId: 'CRIT-01',
            type: 'Copy',
            severity: 'Critical',
            device: 'D',
            text: 'INCOMPLETE — CO lines: 18, present: 15, missing: 3',
          },
        ],
      },
    },
  };
}

test('D26/D27: closing skips the tool findings marked N/A and stores the marks with the checklist', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'd26-engineer@example.com',
    password: 'd26 password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'd26-shadow@example.com',
    password: 'd26 password 1',
    role: 'qa_shadow',
  });
  const cookie = await loginAs(base, 'd26-shadow@example.com', 'd26 password 1');

  // One of the two findings N/A, with its explanation (D26/D27: optional).
  const explainedId = await seedRecord(pool, {
    taskId: 'D-550001',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: naSummary(),
  });
  const explained = await request(
    base, 'POST', `/api/qa-records/${explainedId}/close`,
    {
      checklist: fullChecklist('passed'),
      naFindings: { 'linkStatus#0': 'The dealer has no inventory feed, so the broken link is expected.' },
    },
    cookieHeader(cookie)
  );
  assert.equal(explained.status, 200);
  const { record } = await explained.json();
  assert.equal(record.qaStatus, 'Critical', 'the N/A finding must not reach the status (D26)');
  assert.equal(
    record.qaComment,
    'D / Copy / Critical / INCOMPLETE — CO lines: 18, present: 15, missing: 3',
    'the N/A finding must not reach the comment (D26)'
  );
  assert.equal(record.criticalCount, 1);
  assert.equal(record.failedCount, 0, 'the N/A finding must not be counted (D26)');
  assert.equal(record.opportunityCount, 0);
  assert.deepEqual(await bugRows(pool, explainedId), [
    {
      bug_id: 'CRIT-01',
      source: 'tool',
      device: 'D',
      type: 'Copy',
      severity: 'Critical',
      description: 'INCOMPLETE — CO lines: 18, present: 15, missing: 3',
    },
  ]);

  const explainedRow = await recordRow(pool, explainedId);
  assert.deepEqual(
    parseJsonColumn(explainedRow.checklist),
    {
      ...fullChecklist('passed'),
      _na: { 'linkStatus#0': 'The dealer has no inventory feed, so the broken link is expected.' },
    },
    'the marks are stored with the checklist, in its own key: no migration (D26)'
  );

  // Every finding N/A and no explanation at all (D27: the explanation is
  // optional) → the QA passes with no comment, like a clean run.
  const allNaId = await seedRecord(pool, {
    taskId: 'D-550002',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: naSummary(),
  });
  const allNa = await request(
    base, 'POST', `/api/qa-records/${allNaId}/close`,
    {
      checklist: fullChecklist('passed'),
      naFindings: { 'linkStatus#0': null, 'textDesktop#0': null },
    },
    cookieHeader(cookie)
  );
  assert.equal(allNa.status, 200);
  const passed = (await allNa.json()).record;
  assert.equal(passed.qaStatus, 'Passed');
  assert.equal(passed.qaComment, null, 'no bugs left means no generated comment (D25)');
  assert.equal(passed.criticalCount, 0);
  assert.equal(passed.failedCount, 0);
  assert.equal(passed.opportunityCount, 0);
  assert.deepEqual(await bugRows(pool, allNaId), []);
  assert.deepEqual(
    parseJsonColumn((await recordRow(pool, allNaId)).checklist)._na,
    { 'linkStatus#0': null, 'textDesktop#0': null },
    'null is a stored mark, not a missing one (D27)'
  );
});

test('D26: saving progress keeps the N/A marks; a later close without them counts the findings again', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'd26b-engineer@example.com',
    password: 'd26 password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'd26b-shadow@example.com',
    password: 'd26 password 1',
    role: 'qa_shadow',
  });
  const cookie = await loginAs(base, 'd26b-shadow@example.com', 'd26 password 1');
  const recordId = await seedRecord(pool, {
    taskId: 'D-550003',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: naSummary(),
  });

  // "Guardar avance": the marks are stored with the draft and the QA stays
  // open — the reviewer keeps working on it (D10).
  const saved = await request(
    base, 'PATCH', `/api/qa-records/${recordId}/review`,
    {
      checklist: { 'OPP-01': 'passed' },
      naFindings: { 'linkStatus#0': 'no inventory feed on this page' },
    },
    cookieHeader(cookie)
  );
  assert.equal(saved.status, 200);
  assert.deepEqual(parseJsonColumn((await saved.json()).record.checklist), {
    'OPP-01': 'passed',
    _na: { 'linkStatus#0': 'no inventory feed on this page' },
  });

  const afterSave = await recordRow(pool, recordId);
  assert.equal(afterSave.closed_at, null, 'saving progress must not close the QA');
  assert.equal(afterSave.qa_status, null, 'the status is only generated on closure');
  assert.deepEqual(parseJsonColumn(afterSave.checklist)._na, {
    'linkStatus#0': 'no inventory feed on this page',
  });

  // The payload carries the whole state: a later close that does not
  // repeat the marks counts both findings again (the screen always sends
  // exactly the marks it shows).
  const closed = await request(
    base, 'POST', `/api/qa-records/${recordId}/close`,
    { checklist: fullChecklist('passed') },
    cookieHeader(cookie)
  );
  assert.equal(closed.status, 200);
  const record = (await closed.json()).record;
  assert.equal(record.qaStatus, 'Critical (1), Failed (1)', 'without the marks both findings count again');
  assert.equal(record.criticalCount, 1);
  assert.equal(record.failedCount, 1);
  const closedChecklist = parseJsonColumn((await recordRow(pool, recordId)).checklist);
  assert.equal('_na' in closedChecklist, false, 'a payload without marks replaces the stored ones');
  assert.deepEqual(
    await bugSources(pool, recordId),
    ['tool:FAIL-06', 'tool:CRIT-01'],
    'both tool findings are back as bug rows'
  );
});

test('D26: an invalid naFindings payload answers 400 before any state change', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'd26c-engineer@example.com',
    password: 'd26 password 1',
  });
  const shadowId = await seedUser(pool, {
    email: 'd26c-shadow@example.com',
    password: 'd26 password 1',
    role: 'qa_shadow',
  });
  const cookie = await loginAs(base, 'd26c-shadow@example.com', 'd26 password 1');
  const openId = await seedRecord(pool, {
    taskId: 'D-550004',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: naSummary(),
  });
  const closedId = await seedRecord(pool, {
    taskId: 'D-550005',
    ownerId: engineerId,
    reviewerId: shadowId,
    summary: naSummary(),
    checklist: fullChecklist('passed'),
    qaStatus: 'Passed',
    closedAt: new Date(),
    closedBy: shadowId,
  });

  const save = (naFindings, id = openId) => request(
    base, 'PATCH', `/api/qa-records/${id}/review`,
    { checklist: { 'OPP-01': 'passed' }, naFindings },
    cookieHeader(cookie)
  );

  // The key names one finding of the saved summary: "<check>#<index>".
  for (const [label, naFindings] of [
    ['a key without an index', { linkStatus: null }],
    ['an index that does not exist', { 'linkStatus#9': null }],
    ['a finding with no BUGS.md id (it never counts)', { 'h1#0': null }],
    ['a non-string explanation', { 'linkStatus#0': 42 }],
    ['an unbounded explanation', { 'linkStatus#0': 'x'.repeat(201) }],
  ]) {
    const refused = await save(naFindings);
    assert.equal(refused.status, 400, label);
    assert.equal((await refused.json()).error, 'validation_error', label);
  }

  // Unknown fields are still refused: the singular spelling is not the field.
  const unknownField = await request(
    base, 'PATCH', `/api/qa-records/${openId}/review`,
    { checklist: { 'OPP-01': 'passed' }, naFinding: { 'linkStatus#0': null } },
    cookieHeader(cookie)
  );
  assert.equal(unknownField.status, 400);

  // None of the refusals touched the open record.
  const openRow = await recordRow(pool, openId);
  assert.equal(openRow.checklist, null);
  assert.equal(openRow.qa_status, null);
  assert.equal(openRow.closed_at, null);
  assert.deepEqual(await bugRows(pool, openId), []);

  // A closed QA still answers 409 — and a bad payload on it is still a
  // 400: validation runs before the state guard, so a mistake is never
  // hidden behind "already closed".
  const closedValid = await request(
    base, 'POST', `/api/qa-records/${closedId}/close`,
    { checklist: fullChecklist('passed'), naFindings: { 'linkStatus#0': null } },
    cookieHeader(cookie)
  );
  assert.equal(closedValid.status, 409);
  assert.equal((await closedValid.json()).error, 'record_closed');

  const closedInvalid = await request(
    base, 'POST', `/api/qa-records/${closedId}/close`,
    { checklist: fullChecklist('passed'), naFindings: { 'nope#0': null } },
    cookieHeader(cookie)
  );
  assert.equal(closedInvalid.status, 400);
  assert.equal((await closedInvalid.json()).error, 'validation_error');

  // The closed QA is exactly as it was.
  const closedRow = await recordRow(pool, closedId);
  assert.deepEqual(parseJsonColumn(closedRow.checklist), fullChecklist('passed'));
  assert.equal(closedRow.qa_status, 'Passed');
  assert.ok(closedRow.closed_at);
});

// F5 "Guardar avance" must survive a reload: the pending queue hands the
// reviewer back their own draft (checklist, N/A marks, bug devices and the
// status/comment drafts) so the form can refill. Other rows never carry
// review fields (D10: a draft belongs to whoever took the QA).
test('F5: the queue returns the reviewer\'s saved draft so the form refills after a reload', { skip: skipReason }, async (t) => {
  const { base, pool } = await startApp(t);
  const engineerId = await seedUser(pool, {
    email: 'f5-draft-engineer@example.com',
    password: 'f5 draft password 1',
  });
  const shadow1Id = await seedUser(pool, {
    email: 'f5-draft-shadow1@example.com',
    password: 'f5 draft password 1',
    role: 'qa_shadow',
  });
  await seedUser(pool, {
    email: 'f5-draft-shadow2@example.com',
    password: 'f5 draft password 1',
    role: 'qa_shadow',
  });

  const mineId = await seedRecord(pool, { taskId: 'D-536001', ownerId: engineerId, summary: naSummary() });
  const freeId = await seedRecord(pool, { taskId: 'D-536002', ownerId: engineerId });

  const shadow1Cookie = await loginAs(base, 'f5-draft-shadow1@example.com', 'f5 draft password 1');
  const take = await request(base, 'POST', `/api/qa-records/${mineId}/take`, {}, cookieHeader(shadow1Cookie));
  assert.equal(take.status, 200);

  const draft = {
    checklist: { 'OPP-01': 'passed', 'FAIL-01': 'bug', 'CRIT-03': 'n/a' },
    bugDevices: { 'FAIL-01': 'M/D' },
    naFindings: { 'linkStatus#0': 'no inventory feed on this page' },
    qaStatus: 'Failed',
    qaComment: 'Draft comment',
  };
  const saved = await request(base, 'PATCH', `/api/qa-records/${mineId}/review`, draft, cookieHeader(shadow1Cookie));
  assert.equal(saved.status, 200);

  const queue = await request(base, 'GET', '/api/qa-records', undefined, cookieHeader(shadow1Cookie));
  assert.equal(queue.status, 200);
  const { records } = await queue.json();
  const mine = records.find((record) => record.id === mineId);
  const free = records.find((record) => record.id === freeId);

  assert.equal(mine.reviewerId, shadow1Id);
  assert.deepEqual(mine.checklist, {
    'OPP-01': 'passed',
    'FAIL-01': 'bug',
    'CRIT-03': 'n/a',
    _na: { 'linkStatus#0': 'no inventory feed on this page' },
  });
  assert.deepEqual(mine.bugDevices, { 'FAIL-01': 'M/D' });
  assert.equal(mine.qaStatus, 'Failed');
  assert.equal(mine.qaComment, 'Draft comment');

  // A free QA carries no review fields at all.
  assert.ok(free, 'the free QA stays in the queue');
  for (const field of ['checklist', 'bugDevices', 'qaStatus', 'qaComment']) {
    assert.ok(!(field in free), `a free QA must not carry ${field}`);
  }
});
