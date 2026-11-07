import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { create as createUser } from '../src/repositories/userRepository.js';
import {
  insert,
  insertBugs,
  findByTaskId,
  list,
} from '../src/repositories/qaRecordRepository.js';

// Integration test against a real MySQL/MariaDB (design §10).
// Only TEST_DB_* — never DB_* (rule from L10). Without them it skips.
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
      connectionLimit: 2,
    },
  };
}

const skipReason =
  !testConfig() && 'TEST_DB_HOST/NAME/USER not set (never falls back to DB_*)';

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'db',
  'migrations'
);

async function freshPool(t) {
  const config = testConfig();
  await runMigrations(config.db);
  const pool = createPool(config);
  // qa_records.owner_id REFERENCES users (RESTRICT): the table must be empty
  // before and after every test so the other files' `DELETE FROM users` and
  // migrate.test.js's DROP TABLE keep working.
  await pool.execute('DELETE FROM qa_records');
  t.after(async () => {
    await pool.execute('DELETE FROM qa_records'); // cascades to qa_record_bugs
    await pool.end();
  });

  const owner = await createUser(pool, {
    id: randomUUID(),
    email: `qa-owner-${randomUUID()}@example.com`,
    fullName: 'QA Owner',
    role: 'qa_engineer',
    passwordHash: 'scrypt$N=131072,r=8,p=1$c2FsdA==$aGFzaA==',
    mustChangePassword: false,
    createdBy: null,
    now: new Date(),
  });
  return { pool, ownerId: owner.id };
}

function recordInput(overrides = {}) {
  return {
    id: randomUUID(),
    taskId: 'D-174735',
    ownerId: null, // set by each test from freshPool
    pageUrl: 'https://example.com/inventory/',
    noteForShadow: 'Special spec: keep the CTA above the fold.',
    summary: { version: 1, ranAt: '2026-11-07T14:03:00Z', checks: {} },
    criticalCount: 0,
    failedCount: 0,
    opportunityCount: 0,
    now: new Date('2026-11-07T14:05:00.000Z'),
    ...overrides,
  };
}

test('insert stores the record and findByTaskId returns it (D3, D12, D21)', { skip: skipReason }, async (t) => {
  const { pool, ownerId } = await freshPool(t);
  const input = recordInput({
    ownerId,
    summary: {
      version: 1,
      ranAt: '2026-11-07T14:03:00Z',
      checks: {
        h1: { status: 'fail', total: 2, failed: 1, items: ['Found 2 H1 tags'] },
        linkStatus: {
          status: 'fail',
          total: 120,
          failed: 2,
          items: [{ bugId: 'FAIL-06', url: 'https://example.com/old-page', code: 404 }],
        },
        anchors: { status: 'not_run' },
      },
    },
    criticalCount: 1,
    failedCount: 2,
    opportunityCount: 1,
  });

  const created = await insert(pool, input);

  assert.equal(created.id, input.id);
  assert.equal(created.task_id, 'D-174735');
  assert.equal(created.owner_id, ownerId);
  assert.equal(created.page_url, 'https://example.com/inventory/');
  assert.equal(created.note_for_shadow, 'Special spec: keep the CTA above the fold.');
  // D3/F0: the summary is stored as given and its findings carry the bug id.
  assert.deepEqual(created.summary, input.summary);
  assert.equal(created.summary.checks.linkStatus.items[0].bugId, 'FAIL-06');
  // Review fields are filled later (F5): empty until a QA Shadow closes.
  assert.equal(created.checklist, null);
  assert.equal(created.reviewer_id, null);
  assert.equal(created.qa_status, null);
  assert.equal(created.qa_comment, null);
  assert.equal(created.closed_at, null);
  assert.equal(created.closed_by, null);
  // D21: severity counts stored so the status text can be built from them.
  assert.equal(created.critical_count, 1);
  assert.equal(created.failed_count, 2);
  assert.equal(created.opportunity_count, 1);
  assert.equal(new Date(created.created_at).getTime(), input.now.getTime());
  assert.equal(new Date(created.updated_at).getTime(), input.now.getTime());
  assert.deepEqual(created.bugs, []);

  const found = await findByTaskId(pool, 'D-174735');
  assert.equal(found.id, input.id);
  assert.deepEqual(found.summary, input.summary);
  assert.equal(await findByTaskId(pool, 'Z-999999'), null);
});

test('duplicate task_id is rejected by the unique key', { skip: skipReason }, async (t) => {
  const { pool, ownerId } = await freshPool(t);
  await insert(pool, recordInput({ ownerId }));

  await assert.rejects(
    () => insert(pool, recordInput({ ownerId, id: randomUUID() })),
    (error) => error.code === 'ER_DUP_ENTRY'
  );
  // The rejected insert leaves the first record untouched.
  const rows = await list(pool, { ownerId });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task_id, 'D-174735');
});

test('insertBugs stores every bug with its fields, in insertion order (D20)', { skip: skipReason }, async (t) => {
  const { pool, ownerId } = await freshPool(t);
  const record = await insert(pool, recordInput({ ownerId }));

  await assert.rejects(
    // An unknown record_id cannot take a bug (FK).
    () => insertBugs(pool, randomUUID(), [
      { bugId: 'OPP-01', source: 'manual', device: 'D', type: 'Styling', severity: 'Opportunity', description: 'Margins and paddings too tight' },
    ]),
    (error) => error.code === 'ER_NO_REFERENCED_ROW_2'
  );

  await insertBugs(pool, record.id, []);
  await insertBugs(pool, record.id, [
    { bugId: 'FAIL-06', source: 'tool', device: 'M/D', type: 'Links', severity: 'Failed', description: 'Broken links' },
    { bugId: 'CRIT-03', source: 'manual', device: 'M', type: 'Instructions', severity: 'Critical', description: 'The instructions was not followed as requested' },
    { bugId: 'OPP-01', source: 'manual', device: 'D', type: 'Styling', severity: 'Opportunity', description: 'Margins and paddings too tight' },
  ]);

  const found = await findByTaskId(pool, 'D-174735');
  assert.equal(found.bugs.length, 3);
  // Auto-increment id keeps the order the bugs were reported in (comment lines).
  assert.deepEqual(found.bugs.map((bug) => bug.bug_id), ['FAIL-06', 'CRIT-03', 'OPP-01']);
  assert.equal(found.bugs[0].device, 'M/D');
  assert.equal(found.bugs[0].type, 'Links');
  assert.equal(found.bugs[0].severity, 'Failed');
  assert.equal(found.bugs[0].description, 'Broken links');
  assert.equal(found.bugs[1].severity, 'Critical');
  assert.equal(found.bugs[1].description, 'The instructions was not followed as requested');
});

test('each bug keeps its source: tool vs manual (D9)', { skip: skipReason }, async (t) => {
  const { pool, ownerId } = await freshPool(t);
  const record = await insert(pool, recordInput({ ownerId }));

  await insertBugs(pool, record.id, [
    { bugId: 'FAIL-06', source: 'tool', device: 'M/D', type: 'Links', severity: 'Failed', description: 'Broken links' },
    { bugId: 'CRIT-03', source: 'manual', device: 'M', type: 'Instructions', severity: 'Critical', description: 'The instructions was not followed as requested' },
  ]);

  const found = await findByTaskId(pool, 'D-174735');
  // D9: when a QA Shadow loses the role only its unclosed manual marks are
  // deleted; the tool's findings survive, so both origins must be told apart.
  assert.deepEqual(
    found.bugs.map((bug) => [bug.bug_id, bug.source]),
    [['FAIL-06', 'tool'], ['CRIT-03', 'manual']]
  );
  assert.equal(found.bugs.filter((bug) => bug.source === 'tool').length, 1);
  assert.equal(found.bugs.filter((bug) => bug.source === 'manual').length, 1);
});

test('checklist round-trips passed/bug/n-a per manual item (F0, D19)', { skip: skipReason }, async (t) => {
  const { pool, ownerId } = await freshPool(t);
  const checklist = {
    'OPP-01': 'passed',
    'FAIL-01': 'bug',
    'FAIL-11': 'n/a',
    'FAIL-15': 'passed',
    'CRIT-03': 'bug',
  };

  await insert(pool, recordInput({ ownerId, checklist }));

  const found = await findByTaskId(pool, 'D-174735');
  assert.deepEqual(found.checklist, checklist);
});

test('list filters by owner and created_at range [from, to) (D13 month view)', { skip: skipReason }, async (t) => {
  const { pool, ownerId } = await freshPool(t);
  const other = await createUser(pool, {
    id: randomUUID(),
    email: `qa-other-${randomUUID()}@example.com`,
    fullName: 'Other Owner',
    role: 'qa_engineer',
    passwordHash: 'scrypt$N=131072,r=8,p=1$c2FsdA==$aGFzaA==',
    mustChangePassword: false,
    createdBy: null,
    now: new Date(),
  });

  // November in Bolivia (UTC-4, D13): 2026-11-01T04:00Z .. 2026-12-01T04:00Z.
  const from = new Date('2026-11-01T04:00:00.000Z');
  const to = new Date('2026-12-01T04:00:00.000Z');

  await insert(pool, recordInput({ ownerId, taskId: 'D-100001', now: from })); // at from: included
  await insert(pool, recordInput({ ownerId, taskId: 'D-100002', now: new Date('2026-11-15T12:00:00.000Z') }));
  await insert(pool, recordInput({ ownerId, taskId: 'D-100003', now: to })); // at to: excluded (half-open)
  await insert(pool, recordInput({ ownerId: other.id, taskId: 'D-100004', now: new Date('2026-11-20T12:00:00.000Z') }));

  const mine = await list(pool, { ownerId, from, to });
  assert.deepEqual(mine.map((row) => row.task_id), ['D-100002', 'D-100001']); // newest first

  const everyone = await list(pool, { from, to });
  assert.deepEqual(
    everyone.map((row) => row.task_id),
    ['D-100004', 'D-100002', 'D-100001']
  );

  const all = await list(pool);
  assert.equal(all.length, 4);
  assert.deepEqual(all[0].summary, { version: 1, ranAt: '2026-11-07T14:03:00Z', checks: {} }); // mapped JSON
});

// F1 acceptance: the migrations run as qa_migrator in production, which has
// no DROP privilege. Structural check, no database needed.
test('F1 migration files exist and contain no DROP', async () => {
  const files = ['004_create_qa_records.sql', '005_create_qa_record_bugs.sql'];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    assert.doesNotMatch(sql, /\bDROP\b/i, `${file} must not contain DROP`);
  }
});
