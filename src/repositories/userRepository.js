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

// Admin users API (design §7.2): every account, oldest first.
export async function listAll(pool) {
  const [rows] = await pool.execute(
    `SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC, id ASC`
  );
  return rows;
}

// PATCH /api/admin/users/:id: only the fields present in the patch.
export async function updateUser(pool, { id, fullName, role, isActive, now = new Date() }) {
  const sets = [];
  const params = [];
  if (fullName !== undefined) {
    sets.push('full_name = ?');
    params.push(fullName);
  }
  if (role !== undefined) {
    sets.push('role = ?');
    params.push(role);
  }
  if (isActive !== undefined) {
    sets.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }
  sets.push('updated_at = ?');
  params.push(now, id);
  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(pool, id);
}

// Admin reset (design §7.2): a temporary password always forces the change
// (§5.5). password_changed_at is left untouched on purpose — the user has not
// chosen a password yet, and their own change stamps it (§5.1).
export async function setTemporaryPassword(pool, { id, passwordHash, now = new Date() }) {
  await pool.execute(
    'UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?',
    [passwordHash, now, id]
  );
  return findById(pool, id);
}

// Last-admin guard (design §7.2): a locking read of every active admin, so
// two concurrent demotions can never both believe someone else remains.
// Must run on a connection that already opened a transaction.
export async function listActiveAdminIdsForUpdate(pool) {
  const [rows] = await pool.execute(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = 1 FOR UPDATE"
  );
  return rows.map((row) => row.id);
}
