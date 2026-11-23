import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import test from 'node:test';
import { createQaExcelWorkbook } from '../src/services/qaExcelWorkbookService.js';

const makeResult = (overrides = {}) => ({
  deliverableId: 'D-100',
  website: 'www.ford.com',
  completedPageUrl: 'www.ford.com/new/f150.htm',
  dealerValidation: { isSameDealer: true },
  copyResult: { passed: false, mismatches: ['Desktop: Missing line'] },
  linkResult: { passed: false, missing: ['/finance.htm'] },
  h1Result: { passed: true, mismatches: [] },
  anchorResult: { passed: true, failures: [] },
  imageResult: { passed: true, failures: [] },
  finalStatus: 'Failed',
  ...overrides,
});

test('creates an English Excel report with one row per deliverable and colored statuses', async () => {
  const buffer = await createQaExcelWorkbook([makeResult()]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('QA Results');

  assert.deepEqual(worksheet.getRow(1).values.slice(1), [
    'Deliverable Id', 'Website', 'Completed Page URL', 'Belongs to Dealer',
    'Completed Copy', 'Required Links', 'H1', 'Anchors', 'Images', 'Final Status',
  ]);
  assert.equal(worksheet.rowCount, 2);
  assert.equal(worksheet.getCell('D2').value, 'Yes');
  assert.match(worksheet.getCell('E2').value, /Desktop: Missing line/);
  assert.match(worksheet.getCell('F2').value, /\/finance\.htm/);
  assert.equal(worksheet.getCell('J2').value, 'Failed');
  assert.equal(worksheet.getCell('E2').fill.fgColor.argb, 'FFFCE1E1');
  assert.equal(worksheet.getCell('G2').fill.fgColor.argb, 'FFDDF3E4');
});

test('shows optional empty checks as neutral N/A cells', async () => {
  const result = makeResult({
    copyResult: { passed: true, skipped: true, mismatches: [] },
    linkResult: { passed: true, skipped: true, missing: [] },
    finalStatus: 'Passed',
  });
  const buffer = await createQaExcelWorkbook([result]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.getWorksheet('QA Results');

  assert.equal(worksheet.getCell('E2').value, 'N/A');
  assert.equal(worksheet.getCell('F2').value, 'N/A');
  assert.equal(worksheet.getCell('E2').fill.fgColor.argb, 'FFF3F4F6');
  assert.equal(worksheet.getCell('J2').value, 'Passed');
});