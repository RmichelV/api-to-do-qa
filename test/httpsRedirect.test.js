import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { httpsRedirect } from '../src/middleware/httpsRedirect.js';

// Production HTTPS enforcement (design §5.6, plan T10): Caddy terminates TLS
// and forwards X-Forwarded-Proto, which Express turns into req.secure when
// trust proxy is on (TRUST_PROXY=1, enforced by loadConfig in production).
// Plain HTTP is redirected with 308 so method and body survive, and every
// response carries Strict-Transport-Security. The redirect target comes from
// APP_ORIGIN (validated https in production), never from the request Host.

async function startServer(t, nodeEnv, appOrigin = 'https://public.example') {
  const app = express();
  app.set('trust proxy', 1);
  app.use(httpsRedirect(nodeEnv, appOrigin));
  app.all('/probe', (req, res) => res.json({ secure: req.secure }));
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(async () => {
    server.close();
    await once(server, 'close');
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('production: plain HTTP is redirected to HTTPS keeping method and query', async (t) => {
  const base = await startServer(t, 'production');
  const res = await fetch(`${base}/probe?q=1`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'X-Forwarded-Proto': 'http' },
  });
  assert.equal(res.status, 308);
  // The request Host is 127.0.0.1:<port>; the Location must come from
  // APP_ORIGIN instead, proving the Host header is never trusted.
  assert.equal(res.headers.get('location'), 'https://public.example/probe?q=1');
  assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
});

test('production: requests already forwarded as HTTPS pass through with HSTS', async (t) => {
  const base = await startServer(t, 'production');
  const res = await fetch(`${base}/probe`, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('strict-transport-security'), /max-age=31536000/);
  assert.deepEqual(await res.json(), { secure: true });
});

test('outside production: no redirect and no HSTS', async (t) => {
  const base = await startServer(t, 'development');
  const res = await fetch(`${base}/probe`, {
    redirect: 'manual',
    headers: { 'X-Forwarded-Proto': 'http' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('strict-transport-security'), null);
});
