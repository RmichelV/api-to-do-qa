import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requirePasswordChanged } from '../src/middleware/requirePasswordChanged.js';

// Unit tests for the forced password-change gate (design §5.5). No DB: the
// middleware only reads req.user / req.method / req.path.

const FORCED_USER = Object.freeze({
  id: 'user-1',
  email: 'forced@example.com',
  fullName: 'Forced User',
  role: 'qa_engineer',
  mustChangePassword: true,
});

function run({ method = 'GET', path = '/', user } = {}) {
  const req = { method, path, user };
  const outcome = { next: false, status: null, body: null, redirected: null };
  const res = {
    status(code) {
      outcome.status = code;
      return this;
    },
    json(body) {
      outcome.body = body;
      return this;
    },
    redirect(location) {
      outcome.redirected = location;
      outcome.status = 302;
      return this;
    },
  };
  requirePasswordChanged()(req, res, () => {
    outcome.next = true;
  });
  return outcome;
}

test('requests without a session pass through', () => {
  const outcome = run({ method: 'POST', path: '/api/cancel' });
  assert.equal(outcome.next, true);
  assert.equal(outcome.status, null);
});

test('users who already changed their password pass through', () => {
  const outcome = run({
    method: 'POST',
    path: '/api/cancel',
    user: { ...FORCED_USER, mustChangePassword: false },
  });
  assert.equal(outcome.next, true);
});

test('while forced, GET /api/auth/me is allowed (§5.5)', () => {
  const outcome = run({ method: 'GET', path: '/api/auth/me', user: FORCED_USER });
  assert.equal(outcome.next, true);
});

test('while forced, POST /api/auth/change-password is allowed (§5.5)', () => {
  const outcome = run({
    method: 'POST',
    path: '/api/auth/change-password',
    user: FORCED_USER,
  });
  assert.equal(outcome.next, true);
});

test('while forced, POST /api/auth/logout is allowed (§5.5)', () => {
  const outcome = run({ method: 'POST', path: '/api/auth/logout', user: FORCED_USER });
  assert.equal(outcome.next, true);
});

test('while forced, GET /change-password.html is allowed (§5.5)', () => {
  const outcome = run({ method: 'GET', path: '/change-password.html', user: FORCED_USER });
  assert.equal(outcome.next, true);
});

test('while forced, the change-password screen assets are allowed', () => {
  for (const path of ['/styles.css', '/change-password.js']) {
    const outcome = run({ method: 'GET', path, user: FORCED_USER });
    assert.equal(outcome.next, true, `${path} must pass so the screen can render`);
  }
});

test('while forced, every other API route answers 403 password_change_required', () => {
  for (const [method, path] of [
    ['POST', '/api/cancel'],
    ['POST', '/api/auth/login'],
    ['GET', '/api/auth/other'],
    ['POST', '/api/full-analysis/run'],
  ]) {
    const outcome = run({ method, path, user: FORCED_USER });
    assert.equal(outcome.next, false, `${method} ${path} must not pass`);
    assert.equal(outcome.status, 403, `${method} ${path} must answer 403`);
    assert.equal(outcome.body.error, 'password_change_required');
    assert.equal(typeof outcome.body.message, 'string');
  }
});

test('while forced, every other page redirects to /change-password.html', () => {
  for (const path of ['/', '/index.html', '/login.html']) {
    const outcome = run({ method: 'GET', path, user: FORCED_USER });
    assert.equal(outcome.next, false, `${path} must not pass`);
    assert.equal(outcome.status, 302, `${path} must redirect`);
    assert.equal(outcome.redirected, '/change-password.html');
  }
});
