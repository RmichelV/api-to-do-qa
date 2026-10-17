import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hash,
  verify,
  needsRehash,
  validatePolicy,
  verifyDummy,
  SCRYPT_PARAMS,
} from '../src/services/passwordService.js';

// Unit tests, no DB (design §10). Policy per design §5.1 (NIST SP 800-63B):
// 12–128 characters, must differ from the current password, no composition rules.

test('hash produces the self-describing format from design §5.1', async () => {
  const stored = await hash('correct horse battery staple');
  const match = stored.match(/^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/);
  assert.ok(match, `unexpected format: ${stored}`);
  assert.equal(Number(match[1]), SCRYPT_PARAMS.N);
  assert.equal(Number(match[2]), SCRYPT_PARAMS.r);
  assert.equal(Number(match[3]), SCRYPT_PARAMS.p);
});

test('hash uses a random salt: same password hashes differently', async () => {
  const a = await hash('same-password-123');
  const b = await hash('same-password-123');
  assert.notEqual(a, b);
});

test('verify accepts the correct password and rejects the wrong one', async () => {
  const stored = await hash('correct horse battery staple');
  assert.equal(await verify('correct horse battery staple', stored), true);
  assert.equal(await verify('Wrong password 123', stored), false);
});

test('verify returns false for malformed or tampered stored values', async () => {
  assert.equal(await verify('anything', 'not-a-hash'), false);
  assert.equal(await verify('anything', 'scrypt$N=1,r=1,p=1$bad$bad'), false);
  const stored = await hash('correct horse battery staple');
  const tampered = stored.slice(0, -4) + 'AAAA';
  assert.equal(await verify('correct horse battery staple', tampered), false);
});

test('needsRehash is false for a fresh hash and true when params are weaker', async () => {
  const stored = await hash('correct horse battery staple');
  assert.equal(needsRehash(stored), false);
  const weaker = 'scrypt$N=16384,r=8,p=1$c2FsdHNhbHRzYWx0c2FsdA==$aGFzaGhhc2hoYXNoaGFzaA==';
  assert.equal(needsRehash(weaker), true);
  assert.equal(needsRehash('garbage'), true);
});

test('validatePolicy enforces 12–128 characters and difference from current', () => {
  assert.deepEqual(validatePolicy('abcdefghijk'), { valid: false, errors: ['password_too_short'] });
  assert.deepEqual(validatePolicy('a'.repeat(129)), { valid: false, errors: ['password_too_long'] });
  assert.deepEqual(validatePolicy('short'), { valid: false, errors: ['password_too_short'] });

  assert.deepEqual(validatePolicy('abcdefghijkl'), { valid: true, errors: [] });
  assert.deepEqual(validatePolicy('a'.repeat(128)), { valid: true, errors: [] });
  // No forced composition rules (design §5.1): all-lowercase is valid.
  assert.deepEqual(validatePolicy('aaaaaaaaaaaa'), { valid: true, errors: [] });

  const current = 'my current password';
  assert.deepEqual(validatePolicy(current, current), {
    valid: false,
    errors: ['password_same_as_current'],
  });
  assert.deepEqual(validatePolicy('my current passw0rd', current), { valid: true, errors: [] });
});

test('verifyDummy always fails (uniform timing for unknown emails)', async () => {
  assert.equal(await verifyDummy('any password at all'), false);
  assert.equal(await verifyDummy(''), false);
});
