import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { readImages } from '../src/services/imageReadingService.js';

test('image analysis omits images with inline clip paths on the image or an ancestor', async (t) => {
  const html = `
    <div class="ddc-wrapper">
      <div style="clip-path: url('#top-right-point')">
        <img src="https://images.dealer.com/ancestor-clipped.jpg" alt="Clipped by ancestor">
      </div>
      <div>
        <div data-responsive-image-bg="true" style="clip-path: url('#top-right-point'); background-image: url('data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=')"></div>
        <div><img hidden role="presentation" class="responsive-image d-none" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=" data-src="https://images.dealer.com/clipped-background-proxy.jpg" alt="Clipped proxy"></div>
      </div>
      <img style="-webkit-clip-path: polygon(0 0, 100% 0, 50% 100%)" src="https://images.dealer.com/image-clipped.jpg" alt="Clipped image">
      <img style="clip-path: none" src="https://images.dealer.com/not-clipped.jpg" alt="Not clipped">
      <img src="https://images.dealer.com/visible.jpg" alt="Visible image">
      <div data-widget-name="content-disclaimer"><img src="dr-photoupload-front" alt=""></div>
    </div>
  `;
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));

  const { port } = server.address();
  const { images } = await readImages(`http://127.0.0.1:${port}/`);

  assert.deepEqual(images.map(image => image.src), [
    'https://images.dealer.com/not-clipped.jpg',
    'https://images.dealer.com/visible.jpg',
  ]);
  assert.equal(images.some(image => 'hasClipPath' in image), false);
});