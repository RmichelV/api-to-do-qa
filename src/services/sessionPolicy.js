// Session lifecycle rules (design §5.2) as pure functions with an injected
// clock, so unit tests never depend on real time (design §10).
//
// | Lifetime  | 7 days from login, fixed. expires_at is never extended.       |
// | Rotation  | every 24 h of use: new token, old hash → previous_token_hash |
// | Grace     | previous token accepted for 60 s after rotation              |
// | Activity  | last_seen_at updated at most once every 5 minutes            |

export const ROTATION_AFTER = 24 * 60 * 60 * 1000;
export const ROTATION_GRACE = 60 * 1000;
export const TOUCH_INTERVAL = 5 * 60 * 1000;
export const SESSION_DAYS = 7;

export function isExpired(session, now) {
  if (session.revoked_at !== null && session.revoked_at !== undefined) return true;
  return new Date(session.expires_at).getTime() <= now.getTime();
}

export function needsRotation(session, now) {
  return now.getTime() - new Date(session.rotated_at).getTime() >= ROTATION_AFTER;
}

export function isPreviousTokenValid(session, now) {
  return now.getTime() - new Date(session.rotated_at).getTime() < ROTATION_GRACE;
}

export function shouldTouchLastSeen(session, now) {
  return now.getTime() - new Date(session.last_seen_at).getTime() >= TOUCH_INTERVAL;
}

export function sessionMaxAgeSeconds(session, now) {
  const remaining = new Date(session.expires_at).getTime() - now.getTime();
  return Math.max(0, Math.floor(remaining / 1000));
}
