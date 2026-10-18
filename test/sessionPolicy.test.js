import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isExpired,
  needsRotation,
  isPreviousTokenValid,
  shouldTouchLastSeen,
  sessionMaxAgeSeconds,
  ROTATION_AFTER,
  ROTATION_GRACE,
  TOUCH_INTERVAL,
} from '../src/services/sessionPolicy.js';

// Unit tests with injected time (design §10, §5.2). No DB.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function session(overrides = {}) {
  const now = new Date('2026-10-17T12:00:00.000Z');
  return {
    rotated_at: now,
    last_seen_at: now,
    created_at: now,
    expires_at: new Date(now.getTime() + 7 * DAY),
    revoked_at: null,
    now,
    ...overrides,
  };
}

test('policy constants match design §5.2', () => {
  assert.equal(ROTATION_AFTER, DAY);
  assert.equal(ROTATION_GRACE, 60_000);
  assert.equal(TOUCH_INTERVAL, 5 * 60_000);
});

test('isExpired: fixed 7-day lifetime, revoked sessions are expired', () => {
  assert.equal(isExpired(session(), session().now), false);
  assert.equal(isExpired(session({ expires_at: new Date('2026-10-17T11:59:59.999Z') }), session().now), true);
  assert.equal(isExpired(session({ expires_at: session().now }), session().now), true); // boundary: equal => expired
  const revoked = session({ revoked_at: new Date('2026-10-17T10:00:00.000Z') });
  assert.equal(isExpired(revoked, revoked.now), true);
});

test('needsRotation: every 24 h of use, not before', () => {
  const s = session();
  assert.equal(needsRotation(s, new Date(s.now.getTime() + 23 * HOUR)), false);
  assert.equal(needsRotation(s, new Date(s.now.getTime() + 24 * HOUR)), true); // boundary
  assert.equal(needsRotation(s, new Date(s.now.getTime() + 25 * HOUR)), true);
});

test('isPreviousTokenValid: 60 s grace after rotation, then rejected', () => {
  const rotatedAt = new Date('2026-10-17T12:00:00.000Z');
  const s = session({ rotated_at: rotatedAt });
  assert.equal(isPreviousTokenValid(s, new Date(rotatedAt.getTime() + 59_999)), true);
  assert.equal(isPreviousTokenValid(s, new Date(rotatedAt.getTime() + 60_000)), false); // boundary
  assert.equal(isPreviousTokenValid(s, new Date(rotatedAt.getTime() + 61_000)), false);
});

test('shouldTouchLastSeen: at most once every 5 minutes', () => {
  const s = session();
  assert.equal(shouldTouchLastSeen(s, new Date(s.now.getTime() + 4 * 60_000)), false);
  assert.equal(shouldTouchLastSeen(s, new Date(s.now.getTime() + 5 * 60_000)), true); // boundary
});

test('sessionMaxAgeSeconds: seconds left until expires_at, never extended', () => {
  const s = session();
  assert.equal(sessionMaxAgeSeconds(s, s.now), 7 * DAY / 1000);
  const later = new Date(s.now.getTime() + 2 * DAY);
  assert.equal(sessionMaxAgeSeconds(s, later), 5 * DAY / 1000);
});
