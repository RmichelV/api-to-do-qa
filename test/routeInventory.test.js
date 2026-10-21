import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { createPool } from '../src/db/pool.js';
import { runMigrations } from '../scripts/migrate.js';
import { createApp } from '../src/app.js';
import { PUBLIC_DIR } from '../src/paths.js';
import * as userRepository from '../src/repositories/userRepository.js';
import { hash as hashPassword } from '../src/services/passwordService.js';

// Route inventory (design §6 verification, plan T8): walk the Express router
// stack and the static files on disk. Every registered route must answer
// 401/302 without a session, except the public allow-list of §6 step 4.
// A new route that is not protected makes this test fail.
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

// The ONLY resources an anonymous visitor may reach (design §6, step 4).
// Logout is public per §7.1 idempotency (L25): revokes when the cookie is
// valid and always clears it with 204.
const PUBLIC_ALLOW_LIST = new Set([
  'GET /login.html',
  'GET /login.js',
  'GET /styles.css',
  'GET /healthz',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

// Express 5 layers do not keep the mount prefix, so app.use() is patched
// while createApp() builds the app to pair every mounted handler with its
// path. Restored right after construction.
function recordMounts() {
  const mounts = new Map();
  const original = express.application.use;
  express.application.use = function patchedUse(pathOrFn, ...rest) {
    if (typeof pathOrFn === 'string') {
      for (const fn of rest) mounts.set(fn, pathOrFn);
    } else if (typeof pathOrFn === 'function') {
      mounts.set(pathOrFn, '');
    }
    return original.call(this, pathOrFn, ...rest);
  };
  return {
    mounts,
    restore() {
      express.application.use = original;
    },
  };
}

function joinPath(prefix, suffix) {
  if (!prefix) return suffix === '' ? '/' : suffix;
  if (!suffix || suffix === '/') return prefix;
  return `${prefix.replace(/\/$/, '')}${suffix}`;
}

function collectRoutes(app, mounts) {
  const routes = new Set();
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  function walk(stack, prefix) {
    for (const layer of stack) {
      if (layer.route) {
        const fullPath = joinPath(prefix, layer.route.path);
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          const upper = method.toUpperCase();
          if (enabled === true && methods.has(upper)) {
            routes.add(`${upper} ${fullPath}`);
          }
        }
      } else if (layer.handle && Array.isArray(layer.handle.stack)) {
        const mount = mounts.has(layer.handle) ? mounts.get(layer.handle) : '';
        walk(layer.handle.stack, joinPath(prefix, mount));
      }
    }
  }
  walk(app.router.stack, '');
  return routes;
}

function listFiles(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, rel));
    else out.push(rel);
  }
  return out;
}

async function startApp(t) {
  const config = testConfig();
  await runMigrations(config.db);
  const pool = createPool(config);
  const recorded = recordMounts();
  let app;
  try {
    app = createApp({
      config: { appOrigin: APP_ORIGIN, sessionDays: 7, nodeEnv: 'test' },
      pool,
    });
  } finally {
    recorded.restore();
  }
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
    email: 'inventory@example.com',
    fullName: 'Inventory User',
    role: 'qa_engineer',
    passwordHash: await hashPassword('inventory password 123'),
    mustChangePassword: false,
    isActive: true,
    createdBy: null,
  });
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: JSON.stringify({ email: 'inventory@example.com', password: 'inventory password 123' }),
  });
  assert.equal(login.status, 200);
  const raw = login.headers.get('set-cookie') ?? '';
  const cookie = /qa_session=([^;]*)/.exec(raw)[1];

  return { base, cookie, routes: collectRoutes(app, recorded.mounts) };
}

test('route inventory: anonymous requests only reach the public allow-list', { skip: skipReason }, async (t) => {
  const { base, routes } = await startApp(t);
  // Sanity: the walker really saw the app's route table.
  assert.ok(routes.size >= 10, `expected a non-trivial route table, got: ${[...routes].join(', ')}`);
  assert.ok(routes.has('GET /'), 'expected GET / in the inventory');
  assert.ok(routes.has('POST /api/cancel'), 'expected POST /api/cancel in the inventory');
  assert.ok(routes.has('GET /login.html'), 'expected GET /login.html in the inventory');

  for (const entry of routes) {
    const [method, rawPath] = entry.split(' ');
    const probePath = rawPath.replace(/:[^/]+/g, 'probe');
    const headers = { Origin: APP_ORIGIN };
    // redirect: 'manual' to assert the 302 itself (pattern from T6).
    const response = await fetch(`${base}${probePath}`, { method, headers, redirect: 'manual' });

    if (PUBLIC_ALLOW_LIST.has(entry)) {
      assert.ok(
        response.status !== 302 && response.status !== 401,
        `${entry} is on the public allow-list but answered ${response.status}`
      );
      continue;
    }

    if (rawPath.startsWith('/api/')) {
      assert.equal(response.status, 401, `${entry} must require a session (API)`);
      assert.equal((await response.json()).error, 'unauthenticated', entry);
    } else {
      assert.equal(response.status, 302, `${entry} must require a session (page)`);
      assert.equal(response.headers.get('location'), '/login.html', entry);
    }
  }
});

test('public allow-list: login page, styles and healthz answer anonymously', { skip: skipReason }, async (t) => {
  const { base } = await startApp(t);

  const login = await fetch(`${base}/login.html`);
  assert.equal(login.status, 200);

  const styles = await fetch(`${base}/styles.css`);
  assert.equal(styles.status, 200);
  assert.match(styles.headers.get('content-type') ?? '', /text\/css/);

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const loginPost = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP_ORIGIN },
    body: '{}',
  });
  assert.equal(loginPost.status, 400);
  assert.equal((await loginPost.json()).error, 'validation_error');

  // Logout is public and idempotent (L25): no cookie, still 204 clearing it.
  const logout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Origin: APP_ORIGIN },
  });
  assert.equal(logout.status, 204);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
});

test('static files in public/ redirect anonymous visitors and serve with a session', { skip: skipReason }, async (t) => {
  const { base, cookie } = await startApp(t);
  const files = listFiles(PUBLIC_DIR);
  assert.ok(files.includes('index.html'));

  for (const file of files) {
    const anon = await fetch(`${base}/${file}`, { redirect: 'manual' });
    if (file === 'styles.css') {
      // Shared stylesheet: public on purpose (§6 step 4).
      assert.equal(anon.status, 200, `/${file}`);
    } else {
      assert.equal(anon.status, 302, `/${file} must not be served without a session`);
      assert.equal(anon.headers.get('location'), '/login.html', `/${file}`);
    }
    const authed = await fetch(`${base}/${file}`, {
      headers: { Cookie: `qa_session=${cookie}` },
    });
    assert.equal(authed.status, 200, `/${file} with session`);
  }
});
