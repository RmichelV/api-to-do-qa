import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash, verify } from '../src/services/passwordService.js';

// End-to-end test of the create-admin CLI against a real database (design
// §10). Only TEST_DB_* — never DB_* (rule from L10); the child process gets
// DB_* pointing at the TEST database on purpose, because that is the CLI's
// documented interface. Without TEST_DB_* it skips.
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

function runCreateAdmin(config, answers) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/create-admin.js'], {
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

test('creates the first admin with a console-only password', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);

  const result = await runCreateAdmin(config, [
    'Bootstrap@Example.com',
    'Bootstrap Admin',
    'a-strong-boot-pass',
    'a-strong-boot-pass',
  ]);

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /admin created: bootstrap@example\.com/);

  const user = await userRepository.findByEmail(pool, 'bootstrap@example.com');
  assert.ok(user);
  assert.equal(user.role, 'admin');
  assert.equal(user.must_change_password, 0);
  assert.equal(user.created_by, null);
  assert.equal(user.is_active, 1);
  assert.equal(await verify('a-strong-boot-pass', user.password_hash), true);
  assert.equal(await userRepository.countActiveAdmins(pool), 1);
});

test('stores a password with surrounding spaces exactly as typed', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  const spaced = '  spaced-boot-pass  ';

  const result = await runCreateAdmin(config, [
    'spaced@example.com',
    'Spaced Admin',
    spaced,
    spaced,
  ]);

  assert.equal(result.code, 0, `stderr: ${result.stderr}`);
  const user = await userRepository.findByEmail(pool, 'spaced@example.com');
  assert.ok(user);
  assert.equal(await verify(spaced, user.password_hash), true);
  assert.equal(await verify('spaced-boot-pass', user.password_hash), false);
});

test('refuses to create another admin while one is active', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);
  await userRepository.create(pool, {
    id: randomUUID(),
    email: 'existing@example.com',
    fullName: 'Existing Admin',
    role: 'admin',
    passwordHash: await hash('existing-admin-pass'),
    createdBy: null,
  });

  const result = await runCreateAdmin(config, [
    'second@example.com',
    'Second Admin',
    'another-strong-pass',
    'another-strong-pass',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /active admin already exists/);
  assert.equal(await userRepository.findByEmail(pool, 'second@example.com'), null);
  assert.equal(await userRepository.countActiveAdmins(pool), 1);
});

test('rejects a password that fails the policy without creating a user', { skip: skipReason }, async (t) => {
  const config = testConfig();
  const pool = await freshPool(t);

  const result = await runCreateAdmin(config, [
    'weak@example.com',
    'Weak Password',
    'short',
    'short',
  ]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /password_too_short/);
  assert.equal(await userRepository.findByEmail(pool, 'weak@example.com'), null);
});
