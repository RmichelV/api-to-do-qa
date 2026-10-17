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

export async function countActiveAdmins(pool) {
  const [[row]] = await pool.execute(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1"
  );
  return Number(row.n);
}
