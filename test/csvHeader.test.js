import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingRequiredHeaders, parseCsvHeader } from '../public/csv-header.js';

test('accepts required CSV headers in any order and allows additional columns', () => {
  const headers = parseCsvHeader(
    '\uFEFFWebsite,"Notes, internal",Completed Copy,URL,Links,Deliverable Id,Calls to Action,Completed Page URL\r\n'
  );

  assert.deepEqual(missingRequiredHeaders(headers), []);
});

test('reports required CSV headers that are missing', () => {
  const headers = parseCsvHeader('Deliverable Id,Website,URL\n');

  assert.deepEqual(missingRequiredHeaders(headers), [
    'Links',
    'Calls to Action',
    'Completed Copy',
    'Completed Page URL',
  ]);
});

test('rejects an unclosed quoted header', () => {
  assert.throws(() => parseCsvHeader('Deliverable Id,"Website,URL'), /Unclosed quote/);
});