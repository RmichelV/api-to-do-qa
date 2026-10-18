import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, buildSessionCookie, buildClearCookie } from '../src/utils/cookies.js';

// Unit tests for the cookie helpers (design §5.2). No dependency added:
// the Cookie header is parsed by hand.

test('parseCookies parses the qa_session cookie and ignores the rest', () => {
  assert.deepEqual(parseCookies('other=x; qa_session=abc123; third=1'), { other: 'x', qa_session: 'abc123', third: '1' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies('no_equals_sign'), {});
});

test('buildSessionCookie sets HttpOnly, SameSite=Lax, Path=/ and Max-Age', () => {
  const cookie = buildSessionCookie('tok', 604800, { secure: false });
  assert.match(cookie, /^qa_session=tok;/);
  assert.match(cookie, /Max-Age=604800/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);
});

test('buildSessionCookie adds Secure in production', () => {
  assert.match(buildSessionCookie('tok', 10, { secure: true }), /Secure/);
});

test('buildClearCookie expires the session cookie immediately', () => {
  const cookie = buildClearCookie({ secure: false });
  assert.match(cookie, /^qa_session=;/);
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
});
