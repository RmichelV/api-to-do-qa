import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDealerUrl } from '../src/services/urlValidationService.js';

test('accepts dealer page URLs with the same brand and dealer/CMS host segments', () => {
  const website = 'www.ford.com';
  const completedPageUrls = [
    'www.ford.com/new/f150.htm',
    'www.ford.dealer.cms.com/new/f150.htm',
    'www.ford.cms.dealer.com/new/f150.htm',
  ];

  for (const completedPageUrl of completedPageUrls) {
    assert.deepEqual(validateDealerUrl(website, completedPageUrl), {
      isSameDealer: true,
      websiteBrand: 'ford',
      completedPageBrand: 'ford',
      reason: null,
    });
  }
});

test('rejects a completed page URL for a different brand', () => {
  const result = validateDealerUrl('www.ford.com', 'www.kia.com/new/inventory.htm');

  assert.equal(result.isSameDealer, false);
  assert.equal(result.websiteBrand, 'ford');
  assert.equal(result.completedPageBrand, 'kia');
  assert.equal(result.reason, 'different-dealers');
});

test('accepts URLs without a protocol and ignores hostname casing and trailing dots', () => {
  const result = validateDealerUrl('WWW.FORD.COM.', '//www.ford.dealer.cms.com/path');

  assert.equal(result.isSameDealer, true);
});

test('reports invalid website and completed page URLs', () => {
  assert.equal(validateDealerUrl('', 'www.ford.com').reason, 'invalid-website-url');
  assert.equal(validateDealerUrl('www.ford.com', 'javascript:alert(1)').reason, 'invalid-completed-page-url');
});