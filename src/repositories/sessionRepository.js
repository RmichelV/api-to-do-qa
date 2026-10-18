// user_sessions access (design §4.2, §5.2). Only SHA-256 hashes of tokens
// are stored; the plaintext token lives only in the client cookie.
import { createHash, randomBytes } from 'node:crypto';

const SESSION_COLUMNS =
  'id, user_id, token_hash, previous_token_hash, rotated_at, created_at, ' +
  'last_seen_at, expires_at, revoked_at, user_agent, ip_address';

export function generateSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest();
}

export async function create(
  pool,
  { id, userId, tokenHash, expiresAt, now = new Date(), userAgent = null, ip = null }
) {
  await pool.execute(
    `INSERT INTO user_sessions (${SESSION_COLUMNS})
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`,
    [id, userId, tokenHash, now, now, now, expiresAt, userAgent, ip]
  );
  return findById(pool, id);
}

export async function findById(pool, id) {
  const [rows] = await pool.execute(`SELECT ${SESSION_COLUMNS} FROM user_sessions WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function findByTokenHash(pool, tokenHash) {
  const [rows] = await pool.execute(`SELECT ${SESSION_COLUMNS} FROM user_sessions WHERE token_hash = ?`, [
    tokenHash,
  ]);
  return rows[0] ?? null;
}

export async function findByPreviousTokenHash(pool, tokenHash) {
  const [rows] = await pool.execute(
    `SELECT ${SESSION_COLUMNS} FROM user_sessions WHERE previous_token_hash = ?`,
    [tokenHash]
  );
  return rows[0] ?? null;
}

// Rotation (§5.2): compare-and-swap on the expected current hash so two
// concurrent requests can never both rotate. Returns false when another
// request already rotated the session.
export async function rotate(pool, { id, newTokenHash, expectedTokenHash, now = new Date() }) {
  const [result] = await pool.execute(
    `UPDATE user_sessions
       SET previous_token_hash = token_hash, token_hash = ?, rotated_at = ?, last_seen_at = ?
     WHERE id = ? AND token_hash = ? AND revoked_at IS NULL`,
    [newTokenHash, now, now, id, expectedTokenHash]
  );
  return result.affectedRows === 1;
}

export async function touchLastSeen(pool, { id, now = new Date() }) {
  await pool.execute('UPDATE user_sessions SET last_seen_at = ? WHERE id = ?', [now, id]);
}

export async function revoke(pool, { id, now = new Date() }) {
  await pool.execute('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?', [
    now,
    id,
  ]);
}

// Opportunistic purge (§5.2): expired or revoked rows older than the given
// number of days. Runs on login; failure there must never block the login.
export async function purgeExpired(pool, { now = new Date(), olderThanDays = 7 }) {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  await pool.execute(
    'DELETE FROM user_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)',
    [cutoff, cutoff]
  );
}
