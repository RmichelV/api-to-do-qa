import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import {
  activeAnchorFetchControllers,
  extractAndValidateAnchors,
} from '../src/services/anchorReadingService.js';

test('anchor analysis fetches once and returns anchors from the downloaded HTML', async (t) => {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++;
    const target = requests <= 2 ? '<div id="section"></div>' : '';
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`
      <div class="ddc-wrapper">
        <a href="#section">Button 1</a>
        <a href="#section">Button 2</a>
        ${target}
        <a href="/other#section">Other page</a>
      </div>
    `);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const result = await extractAndValidateAnchors(`http://127.0.0.1:${port}/`);

  assert.equal(requests, 1);
  assert.deepEqual(result.anchors, [{
    text: 'Button 1',
    href: '#section',
    targetExists: true,
  }, {
    text: 'Button 2',
    href: '#section',
    targetExists: true,
  }]);
  assert.deepEqual(result.misconfiguredAnchors, [{
    text: 'Other page',
    href: '/other#section',
  }]);
});

test('anchor analysis retries 403 and uses the first later successful response', async (t) => {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++;
    if (requests === 1) {
      response.writeHead(403, { 'content-type': 'text/html' });
      response.end('Forbidden');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<div class="ddc-wrapper"><a href="#contact">Contact</a><div id="contact"></div></div>');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const result = await extractAndValidateAnchors(`http://127.0.0.1:${port}/`, { retryDelayMs: 0 });

  assert.equal(requests, 2);
  assert.deepEqual(result.anchors, [{ text: 'Contact', href: '#contact', targetExists: true }]);
});

test('anchor analysis stops retrying when the upstream returns 404', async (t) => {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++;
    response.writeHead(requests === 1 ? 403 : 404, { 'content-type': 'text/plain' });
    response.end(requests === 1 ? 'Forbidden' : 'Not Found');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  await assert.rejects(
    extractAndValidateAnchors(`http://127.0.0.1:${port}/`, { retryDelayMs: 0 }),
    /HTTP 404/
  );
  assert.equal(requests, 2);
});

test('anchor analysis stops after five consecutive 403 responses', async (t) => {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++;
    response.writeHead(403, { 'content-type': 'text/plain' });
    response.end('Forbidden');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  await assert.rejects(
    extractAndValidateAnchors(`http://127.0.0.1:${port}/`, { retryDelayMs: 0 }),
    /HTTP 403 after 5 attempts/
  );
  assert.equal(requests, 5);
});

test('anchor fetch can be cancelled while the upstream response is pending', async (t) => {
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const request = extractAndValidateAnchors(`http://127.0.0.1:${port}/`);
  await new Promise(resolve => server.once('request', resolve));
  for (const controller of activeAnchorFetchControllers) controller.abort();

  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(activeAnchorFetchControllers.size, 0);
});