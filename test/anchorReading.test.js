import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { extractAndValidateAnchors } from '../src/services/anchorReadingService.js';

test('anchor analysis runs three times and returns the majority result', async (t) => {
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

  assert.equal(requests, 3);
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