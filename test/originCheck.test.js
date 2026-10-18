import { test } from 'node:test';
import assert from 'node:assert/strict';
import { originCheck } from '../src/middleware/originCheck.js';

// Unit tests for the CSRF origin check (design §5.3). No DB.

const APP_ORIGIN = 'http://localhost:4000';
const STATE_CHANGING = ['POST', 'PUT', 'PATCH', 'DELETE'];

function run(headers = {}, method = 'POST') {
  return new Promise((resolve) => {
    const middleware = originCheck(APP_ORIGIN);
    const req = { method, headers };
    const res = {
      statusCode: null,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    setImmediate(() => resolve({ nextCalled, statusCode: res.statusCode, body: res.body }));
  });
}

test('safe methods never hit the check', async () => {
  assert.equal((await run({}, 'GET')).nextCalled, true);
  assert.equal((await run({}, 'HEAD')).nextCalled, true);
});

test('state-changing request with matching Origin passes', async () => {
  const result = await run({ origin: APP_ORIGIN });
  assert.equal(result.nextCalled, true);
});

test('state-changing request with a foreign Origin is rejected', async () => {
  const result = await run({ origin: 'https://evil.example' });
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, { error: 'invalid_origin' });
});

test('Referer is accepted when Origin is missing', async () => {
  assert.equal((await run({ referer: `${APP_ORIGIN}/login.html` })).nextCalled, true);
  assert.equal((await run({ referer: 'https://evil.example/x' })).nextCalled, false);
});

test('missing Origin and Referer is rejected', async () => {
  const result = await run({});
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
});
