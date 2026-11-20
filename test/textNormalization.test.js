import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeText } from '../src/utils/normalization.js';
import { compareTextContent } from '../src/services/textReadingService.js';
import { compareMobileTextContent } from '../src/services/textReadingMobileService.js';

test('normalizes typographic dashes to the standard hyphen', () => {
  assert.equal(
    normalizeText('A\u2010B A\u2011B A\u2012B A\u2013B A\u2014B A\u2015B A\u2212B A\u00ADB'),
    'a-b a-b a-b a-b a-b a-b a-b ab',
  );
});

test('ignores registered trademark markers in their common forms', () => {
  assert.equal(normalizeText('Vehicle® VehicleⓇ Vehicleⓡ Vehicle (R)'), 'vehicle vehicle vehicle vehicle');
});

test('desktop and mobile comparisons ignore dash and registered-mark differences', () => {
  const pageText = 'Long\u2014term ownership experience®';
  const originalText = 'Long-term ownership experience';

  for (const compare of [compareTextContent, compareMobileTextContent]) {
    const result = compare(pageText, originalText);
    assert.equal(result.result.complete, true);
    assert.equal(result.details[0].found, true);
  }
});