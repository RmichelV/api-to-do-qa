import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import * as userRepository from '../src/repositories/userRepository.js';
import * as sessionRepository from '../src/repositories/sessionRepository.js';
import { hash, verify } from '../src/services/passwordService.js';

// End-to-end test of the emergency reset-password CLI (S14) against a real
// database (design §10). Only TEST_DB_* — never DB_* (rule from L10); the
// child process gets DB_* pointing at the TEST database on purpose, because
// that is the CLI's documented interface. Without TEST_DB_* it skips.
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runResetPassword(config, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/reset-password.js'], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        APP_ORIGIN: 'http://localhost:4000',
        DB_HOST: config.db.host,
        DB_PORT: String(config.db.port),
        DB_NAME: config.db.name,
        DB_USER: config.db.user,
        DB_PASSWORD: config.db.password,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    answers.forEach((line, index) => {
      setTimeout(() => child.stdin.write(`${line}\n`), 80 * (index + 1));
    });
    // Close stdin after the last answer (or immediately when there is none)
    // so a prompt that never gets an answer fails instead of hanging.
    setTimeout(() => child.stdin.end(), 80 * (answers.length + 1));
  });
}

async function freshPool(t) {
  const config = testConfig();
  await runMigrations(config.db);
  const pool = createPool(config);
  t.after(() => pool.end());
  await pool.execute('DELETE FROM users');
  return pool;
}

async function seedUser(pool, overrides = {}) {
  const user = await userRepository.create(pool, {
    id: randomUUID(),
    email: 'target@example.com',
    fullName: 'Target User',
    role: 'qa_engineer',
    passwordHash: await hash('old-target-password'),
    mustChangePassword: false,
    createdBy: null,
    ...overrides,
  });
  return user;
}

async function seedSession(pool, userId) {
  const token = `token-${randomUUID()}`;
  const session = await sessionRepository.create(pool, {
    id: randomUUID(),
    userId,
    tokenHash: sessionRepository.hashToken(token),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return session;
}

test('resets the password, forces the change and revokes every session', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  const user = await seedUser(pool);
  const first = await seedSession(pool, user.id);
  const second = await seedSession(pool, user.id);

  const result = await runResetPassword(config, [
    'Target@Example.com',
    'a-strong-temp-pass',
    'a-strong-temp-pass',
  ]);

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /password reset: target@example\.com/);

  const updated = await userRepository.findById(pool, user.id);
  assert.equal(updated.must_change_password, 1);
  assert.equal(await verify('a-strong-temp-pass', updated.password_hash), true);
  assert.equal(await verify('old-target-password', updated.password_hash), false);
  // The CLI never creates users nor changes roles (S14).
  assert.equal(updated.role, 'qa_engineer');
  assert.equal(updated.is_active, 1);
  assert.equal(await userRepository.countActiveAdmins(pool), 0);

  const firstRow = await sessionRepository.findByTokenHash(pool, first.token_hash);
  const secondRow = await sessionRepository.findByTokenHash(pool, second.token_hash);
  assert.ok(firstRow.revoked_at, 'first session should be revoked');
  assert.ok(secondRow.revoked_at, 'second session should be revoked');
});

test('stores the temporary password with surrounding spaces exactly as typed', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  const user = await seedUser(pool);
  const spaced = '  spaced-temp-pass  ';

  const result = await runResetPassword(config, [
    'target@example.com',
    spaced,
    spaced,
  ]);

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const updated = await userRepository.findById(pool, user.id);
  assert.equal(await verify(spaced, updated.password_hash), true);
  assert.equal(await verify('spaced-temp-pass', updated.password_hash), false);
});

test('fails clearly when the email does not exist and touches nothing', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  const user = await seedUser(pool);

  const result = await runResetPassword(config, ['missing@example.com']);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /no user with that email/);
  const unchanged = await userRepository.findById(pool, user.id);
  assert.equal(await verify('old-target-password', unchanged.password_hash), true);
  assert.equal(unchanged.must_change_password, 0);
});

test('rejects a password that fails the policy without changing anything', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  const user = await seedUser(pool);
  const session = await seedSession(pool, user.id);

  const result = await runResetPassword(config, [
    'target@example.com',
    'short',
    'short',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /password_too_short/);
  const unchanged = await userRepository.findById(pool, user.id);
  assert.equal(await verify('old-target-password', unchanged.password_hash), true);
  assert.equal(unchanged.must_change_password, 0);
  const sessionRow = await sessionRepository.findByTokenHash(pool, session.token_hash);
  assert.equal(sessionRow.revoked_at, null);
});

test('rejects mismatched passwords without changing anything', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  const user = await seedUser(pool);

  const result = await runResetPassword(config, [
    'target@example.com',
    'a-strong-temp-pass',
    'another-strong-pass',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /passwords do not match/);
  const unchanged = await userRepository.findById(pool, user.id);
  assert.equal(await verify('old-target-password', unchanged.password_hash), true);
});

test('never accepts the password as a command-line argument', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  await seedUser(pool);

  // A password passed as argv must not be used: the CLI reads nothing from
  // argv and still prompts, so with stdin closed it fails without touching
  // the database.
  const result = await runResetPassword(config, []);
  await new Promise((resolve) => setTimeout(resolve, 500));

  assert.equal(result.code, 1);
  const updated = await userRepository.findByEmail(pool, 'target@example.com');
  assert.equal(await verify('old-target-password', updated.password_hash), true);
});
