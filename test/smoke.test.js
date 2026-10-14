import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

let server;
let baseUrl;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET / serves the index page', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<html/i);
});

test('POST /api/full-analysis/run without url responds 400 as before', async () => {
  const res = await fetch(`${baseUrl}/api/full-analysis/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Missing url' });
});

test('POST /api/cancel responds with the cancellation summary', async () => {
  const res = await fetch(`${baseUrl}/api/cancel`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cancelled, true);
  assert.equal(typeof body.browsersClosed, 'number');
});
