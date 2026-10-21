// users table access (design §4.1). Plain SQL, prepared statements, no ORM.
//
// Every function takes the pool explicitly: no hidden global connection, so
// tests can point the same code at the test database (design §4.5: services
// never read `req`; controllers/services pass what the repository needs).
//
// Email invariant (design §4.1): stored trimmed and lowercased; the
// case-insensitive collation also makes the unique key case-insensitive.
export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

const USER_COLUMNS =
  'id, email, full_name, role, password_hash, must_change_password, is_active, ' +
  'password_changed_at, last_login_at, created_by, created_at, updated_at';

export async function create(
  pool,
  { id, email, fullName, role, passwordHash, mustChangePassword = true, isActive = true, createdBy = null, now = new Date() }
) {
  await pool.execute(
    `INSERT INTO users (${USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    [
      id,
      normalizeEmail(email),
      fullName,
      role,
      passwordHash,
      mustChangePassword ? 1 : 0,
      isActive ? 1 : 0,
      now,
      createdBy,
      now,
      now,
    ]
  );
  return findById(pool, id);
}

export async function findById(pool, id) {
  const [rows] = await pool.execute(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`, [id]);
  return rows[0] ?? null;
}

export async function findByEmail(pool, email) {
  const [rows] = await pool.execute(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`, [
    normalizeEmail(email),
  ]);
  return rows[0] ?? null;
}

// Self-service password change (§5.1, §5.5): new hash, flag cleared and
// password_changed_at stamped in one statement.
export async function updatePassword(pool, { id, passwordHash, now = new Date() }) {
  await pool.execute(
    `UPDATE users
        SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ?
      WHERE id = ?`,
    [passwordHash, now, now, id]
  );
  return findById(pool, id);
}

export async function countActiveAdmins(pool) {
  const [[row]] = await pool.execute(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
  );
  return Number(row.n);
}
