import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import {
  create,
  findByEmail,
  findById,
  countActiveAdmins,
  normalizeEmail,
} from '../src/repositories/userRepository.js';

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

async function freshPool(t) {
  const config = testConfig();
  await runMigrations(config.db);
  const pool = createPool(config);
  t.after(() => pool.end());
  await pool.execute('DELETE FROM users');
  return pool;
}

function adminRow(overrides = {}) {
  return {
    id: randomUUID(),
    email: 'Admin@Example.COM',
    fullName: 'Test Admin',
    role: 'admin',
    passwordHash: 'scrypt$N=131072,r=8,p=1$c2FsdA==$aGFzaA==',
    mustChangePassword: false,
    createdBy: null,
    now: new Date(),
    ...overrides,
  };
}

test('create stores the user and findById returns it (S1, S10)', { skip: skipReason }, async (t) => {
  const pool = await freshPool(t);
  const input = adminRow();

  const user = await create(pool, input);

  assert.equal(user.id, input.id);
  assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(user.email, 'admin@example.com'); // trimmed + lowercased (§4.1)
  assert.equal(user.full_name, 'Test Admin');
  assert.equal(user.role, 'admin');
  assert.equal(user.password_hash, input.passwordHash);
  assert.equal(user.must_change_password, 0);
  assert.equal(user.is_active, 1);
  assert.equal(user.created_by, null);
  assert.equal(user.last_login_at, null);

  const byId = await findById(pool, input.id);
  assert.equal(byId.email, 'admin@example.com');
  assert.equal(await findById(pool, randomUUID()), null);
});

test('findByEmail is case-insensitive on the stored form', { skip: skipReason }, async (t) => {
  const pool = await freshPool(t);
  await create(pool, adminRow({ email: 'Someone@Example.com' }));

  const found = await findByEmail(pool, '  SOMEONE@EXAMPLE.COM  ');
  assert.ok(found);
  assert.equal(found.email, 'someone@example.com');

  assert.equal(await findByEmail(pool, 'missing@example.com'), null);
  assert.equal(normalizeEmail('  A@B.C '), 'a@b.c');
});

test('duplicate email is rejected by the unique key', { skip: skipReason }, async (t) => {
  const pool = await freshPool(t);
  await create(pool, adminRow({ email: 'dup@example.com' }));

  await assert.rejects(
    () => create(pool, adminRow({ email: ' DUP@example.com ', id: randomUUID() })),
    (error) => error.code === 'ER_DUP_ENTRY'
  );
});

test('countActiveAdmins counts only active admins (S5)', { skip: skipReason }, async (t) => {
  const pool = await freshPool(t);
  assert.equal(await countActiveAdmins(pool), 0);

  const admin = await create(pool, adminRow({ email: 'active-admin@example.com' }));
  await create(pool, adminRow({ email: 'disabled-admin@example.com', isActive: false }));
  await create(pool, adminRow({ email: 'engineer@example.com', role: 'qa_engineer' }));
  assert.equal(await countActiveAdmins(pool), 1);

  await pool.execute('UPDATE users SET is_active = 0 WHERE id = ?', [admin.id]);
  assert.equal(await countActiveAdmins(pool), 0);
});
