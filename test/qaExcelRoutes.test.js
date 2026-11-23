import assert from 'node:assert/strict';
import express from 'express';
import ExcelJS from 'exceljs';
import { createServer } from 'node:http';
import test from 'node:test';
import { requireRole } from '../src/middleware/requireRole.js';
import qaExcelRoutes from '../src/routes/qaExcelRoutes.js';

const listen = async (server) => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};

const close = server => new Promise((resolve, reject) => {
  server.close(error => error ? reject(error) : resolve());
});

test('admin CSV upload runs the QA services and returns a populated XLSX', async (t) => {
  const pageHtml = `
    <h1>Ford F-150</h1>
    <div class="ddc-wrapper">
      <p>Ford F-150 quality</p>
      <a href="/inventory/">Inventory</a>
      <a href="#inventory">Inventory section</a>
      <div id="inventory">Available inventory</div>
    </div>
  `;
  const pageServer = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(pageHtml);
  });
  const pageOrigin = await listen(pageServer);
  t.after(() => close(pageServer));

  const app = express();
  app.use((req, _, next) => {
    req.user = { role: 'admin' };
    next();
  });
  app.use('/api/admin/qa-excel', requireRole('admin'), qaExcelRoutes);
  const apiServer = createServer(app);
  const apiOrigin = await listen(apiServer);
  t.after(() => close(apiServer));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const requestUrl = new URL(typeof input === 'string' ? input : input.url);
    if (requestUrl.hostname === 'www.ford.test') {
      return originalFetch(`${pageOrigin}${requestUrl.pathname}${requestUrl.search}`, options);
    }
    return originalFetch(input, options);
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const csv = [
    'Deliverable Id,Website,Links,Calls to Action,Completed Copy,Completed Page URL',
    'D-200,www.ford.com,/inventory/,,Ford F-150 quality,https://www.ford.test/vehicle.htm',
    'D-201,www.ford.com,,,,https://www.ford.test/vehicle.htm',
  ].join('\r\n');
  const response = await originalFetch(`${apiOrigin}/api/admin/qa-excel/run`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv' },
    body: csv,
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml\.sheet/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  const worksheet = workbook.getWorksheet('QA Results');
  assert.equal(worksheet.rowCount, 3);
  assert.equal(worksheet.getCell('A2').value, 'D-200');
  assert.equal(worksheet.getCell('D2').value, 'Yes');
  assert.equal(worksheet.getCell('E2').value, 'Passed');
  assert.equal(worksheet.getCell('F2').value, 'Passed');
  assert.equal(worksheet.getCell('G2').value, 'Passed');
  assert.equal(worksheet.getCell('H2').value, 'Passed');
  assert.equal(worksheet.getCell('I2').value, 'Passed');
  assert.equal(worksheet.getCell('J2').value, 'Passed');
  assert.equal(worksheet.getCell('E3').value, 'N/A');
  assert.equal(worksheet.getCell('F3').value, 'N/A');
  assert.equal(worksheet.getCell('J3').value, 'Passed');
});

test('QA engineers cannot access the admin Excel endpoint', async (t) => {
  const app = express();
  app.use((req, _, next) => {
    req.user = { role: 'qa_engineer' };
    next();
  });
  app.use('/api/admin/qa-excel', requireRole('admin'), qaExcelRoutes);
  const server = createServer(app);
  const origin = await listen(server);
  t.after(() => close(server));

  const response = await fetch(`${origin}/api/admin/qa-excel/run`, {
    method: 'POST',
    headers: { 'content-type': 'text/csv' },
    body: 'ignored',
  });

  assert.equal(response.status, 403);
});