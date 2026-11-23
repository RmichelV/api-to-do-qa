import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQaCsv, runQaRow } from '../src/services/qaExcelService.js';

const sampleRow = {
  'Deliverable Id': 'D-100',
  Website: 'www.ford.com',
  Links: '/inventory/index.htm',
  'Calls to Action': '/finance.htm',
  'Completed Copy': 'Ford quality vehicles',
  'Completed Page URL': 'www.ford.com/new/f150.htm',
};

const passingAnalysis = {
  desktop: {
    result: { complete: true },
    details: [],
    anchors: [
      { url: 'https://www.ford.com/inventory/', originalHref: '/inventory/' },
      { url: 'https://www.ford.com/finance.htm', originalHref: '/finance.htm' },
    ],
  },
  mobile: { result: { complete: true }, details: [] },
  h1Comparison: {
    same: true,
    desktop: { h1Texts: ['Ford F-150'], srOnlyText: null },
    mobile: { h1Texts: ['Ford F-150'], srOnlyText: null },
  },
  images: [{ status: 'Passed', ddcHosted: true, hasAlt: true, hasTitle: true, titleRequired: true }],
};

test('parses CSV rows with quoted commas and validates required headers', () => {
  const rows = parseQaCsv(
    'Deliverable Id,Website,Links,Calls to Action,Completed Copy,Completed Page URL\r\nD-1,www.ford.com,/inventory,"/finance,/contact","Text, with comma",www.ford.com/page.htm\r\n',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Completed Copy'], 'Text, with comma');
  assert.equal(rows[0]['Calls to Action'], '/finance,/contact');
  assert.throws(() => parseQaCsv('Deliverable Id,Website\nD-1,www.ford.com'), /Missing required columns/);
});

test('parses the workspace-style semicolon CSV without the redundant URL column', () => {
  const rows = parseQaCsv(
    'Deliverable Id;Website;Links;Calls to Action;Completed Copy;Completed Page URL\r\nD-1;www.ford.com;;;;www.ford.com/page.htm\r\n',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].Links, '');
  assert.equal(rows[0]['Calls to Action'], '');
  assert.equal(rows[0]['Completed Copy'], '');
});

test('runs each QA check against Completed Page URL and returns a passing row', async () => {
  let analyzedUrl;
  const result = await runQaRow(sampleRow, {
    analyzePage: async (url, copy, options) => {
      analyzedUrl = url;
      assert.equal(copy, sampleRow['Completed Copy']);
      assert.equal(options.includeLinkStatuses, false);
      return passingAnalysis;
    },
    analyzeAnchors: async (url) => {
      assert.equal(url, analyzedUrl);
      return { anchors: [{ text: 'Inventory', href: '#inventory', targetExists: true }], misconfiguredAnchors: [] };
    },
  });

  assert.equal(analyzedUrl, 'https://www.ford.com/new/f150.htm');
  assert.equal(result.finalStatus, 'Passed');
  assert.equal(result.linkResult.passed, true);
  assert.equal(result.dealerValidation.isSameDealer, true);
});

test('matches required links supplied as relative paths or bare domain URLs', async () => {
  const row = {
    ...sampleRow,
    Links: 'inventory/index.htm',
    'Calls to Action': 'www.ford.com/finance.htm',
  };
  const result = await runQaRow(row, {
    analyzePage: async () => passingAnalysis,
    analyzeAnchors: async () => ({ anchors: [], misconfiguredAnchors: [] }),
  });

  assert.equal(result.linkResult.passed, true);
});

test('allows empty optional link and copy fields without failing the row', async () => {
  const row = { ...sampleRow, Links: '', 'Calls to Action': '', 'Completed Copy': '' };
  const result = await runQaRow(row, {
    analyzePage: async () => passingAnalysis,
    analyzeAnchors: async () => ({ anchors: [], misconfiguredAnchors: [] }),
  });

  assert.equal(result.copyResult.skipped, true);
  assert.equal(result.copyResult.passed, true);
  assert.equal(result.linkResult.skipped, true);
  assert.equal(result.linkResult.passed, true);
  assert.equal(result.finalStatus, 'Passed');
});

test('fails only the affected checks and reports missing required links', async () => {
  const analysis = structuredClone(passingAnalysis);
  analysis.desktop.anchors = [];
  analysis.desktop.details = [{ line: 'Missing sentence', found: false }];
  analysis.desktop.result.complete = false;
  analysis.images = [{ status: 'Failed', ddcHosted: true, hasAlt: false, hasTitle: false, titleRequired: true, src: '/bad.jpg' }];
  const result = await runQaRow(sampleRow, {
    analyzePage: async () => analysis,
    analyzeAnchors: async () => ({ anchors: [{ text: 'Back to top', href: '#missing', targetExists: false }], misconfiguredAnchors: [] }),
  });

  assert.equal(result.finalStatus, 'Failed');
  assert.deepEqual(result.copyResult.mismatches, ['Desktop: Missing sentence']);
  assert.deepEqual(result.linkResult.missing, ['/inventory/index.htm', '/finance.htm']);
  assert.equal(result.anchorResult.passed, false);
  assert.equal(result.imageResult.passed, false);
});

test('treats a matching sr-only-only H1 as passed', async () => {
  const analysis = structuredClone(passingAnalysis);
  analysis.h1Comparison.desktop = { h1Texts: [], srOnlyText: 'Ford F-150' };
  analysis.h1Comparison.mobile = { h1Texts: [], srOnlyText: 'Ford F-150' };
  const result = await runQaRow(sampleRow, {
    analyzePage: async () => analysis,
    analyzeAnchors: async () => ({ anchors: [], misconfiguredAnchors: [] }),
  });

  assert.equal(result.h1Result.passed, true);
});

test('fails when the visible H1 differs from the sr-only H1', async () => {
  const analysis = structuredClone(passingAnalysis);
  analysis.h1Comparison.desktop = { h1Texts: ['Ford F-150'], srOnlyText: 'Ford Ranger' };
  analysis.h1Comparison.mobile = { h1Texts: ['Ford F-150'], srOnlyText: 'Ford Ranger' };
  const result = await runQaRow(sampleRow, {
    analyzePage: async () => analysis,
    analyzeAnchors: async () => ({ anchors: [], misconfiguredAnchors: [] }),
  });

  assert.equal(result.h1Result.passed, false);
  assert.match(result.h1Result.mismatches[0], /H1 and sr-only H1 differ/);
});