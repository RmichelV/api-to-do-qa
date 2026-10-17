// Password hashing (design §5.1, NIST SP 800-63B).
//
// scrypt from node:crypto: accepted by OWASP, no dependencies, no native
// compilation. Stored as a self-describing string
//   scrypt$N=131072,r=8,p=1$<salt_b64>$<hash_b64>
// so the parameters can be raised later (needsRehash → rehash on next login).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const SCRYPT_PARAMS = Object.freeze({
  N: 131072, // 2^17
  r: 8,
  p: 1,
  keylen: 64,
  maxmem: 256 * 1024 * 1024, // 256 MiB
});

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// Upper bounds for parameters accepted from a stored string, so a tampered
// row cannot make verification allocate unbounded memory.
const MAX_ACCEPTED_N = 2 ** 20;
const MAX_ACCEPTED_R = 32;

const HASH_PATTERN = /^scrypt\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function parse(stored) {
  const match = HASH_PATTERN.exec(stored ?? '');
  if (!match) return null;
  const parsed = {
    N: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
    salt: Buffer.from(match[4], 'base64'),
    hash: Buffer.from(match[5], 'base64'),
  };
  if (
    !Number.isInteger(parsed.N) || !Number.isInteger(parsed.r) || !Number.isInteger(parsed.p) ||
    parsed.N < 2 || parsed.N > MAX_ACCEPTED_N ||
    parsed.r < 1 || parsed.r > MAX_ACCEPTED_R ||
    parsed.p < 1 || parsed.salt.length === 0 || parsed.hash.length === 0
  ) {
    return null;
  }
  return parsed;
}

export async function hash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return (
    `scrypt$N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}` +
    `$${salt.toString('base64')}$${derived.toString('base64')}`
  );
}

export async function verify(password, stored) {
  const parsed = parse(stored);
  if (!parsed) return false;
  let derived;
  try {
    derived = await scrypt(password, parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });
  } catch {
    return false;
  }
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

export function needsRehash(stored) {
  const parsed = parse(stored);
  if (!parsed) return true;
  return (
    parsed.N !== SCRYPT_PARAMS.N ||
    parsed.r !== SCRYPT_PARAMS.r ||
    parsed.p !== SCRYPT_PARAMS.p ||
    parsed.hash.length !== SCRYPT_PARAMS.keylen
  );
}

// Policy (design §5.1): 12–128 characters, must differ from the current
// password, no forced composition rules.
export function validatePolicy(password, currentPassword) {
  const errors = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) errors.push('password_too_short');
  if (length > PASSWORD_MAX_LENGTH) errors.push('password_too_long');
  if (currentPassword !== undefined && password === currentPassword) {
    errors.push('password_same_as_current');
  }
  return { valid: errors.length === 0, errors };
}

// Uniform timing for unknown or inactive emails (design §5.1): burn the same
// scrypt work as a real verification, then always fail.
const DUMMY_SALT = Buffer.alloc(16, 0x5a);
export async function verifyDummy(password) {
  await scrypt(password, DUMMY_SALT, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return false;
}
