// login_attempts access (design §4.3, §5.4). The brute-force log survives
// restarts and multiple instances.
export async function record(pool, { email, ip, succeeded = false, now = new Date() }) {
  await pool.execute(
    'INSERT INTO login_attempts (email, ip_address, succeeded, attempted_at) VALUES (?, ?, ?, ?)',
    [email, ip || '', succeeded ? 1 : 0, now]
  );
}

export async function countFailed(pool, { email, since }) {
  const [[row]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND succeeded = 0 AND attempted_at >= ?',
    [email, since]
  );
  return Number(row.n);
}

export async function countFailedByIp(pool, { ip, since }) {
  const [[row]] = await pool.execute(
    'SELECT COUNT(*) AS n FROM login_attempts WHERE ip_address = ? AND succeeded = 0 AND attempted_at >= ?',
    [ip || '', since]
  );
  return Number(row.n);
}

// Opportunistic purge (§5.2): attempts older than the cutoff (24 h on login).
export async function purgeOlderThan(pool, { cutoff }) {
  await pool.execute('DELETE FROM login_attempts WHERE attempted_at < ?', [cutoff]);
}
