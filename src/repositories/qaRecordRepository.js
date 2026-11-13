// qa_records access (PLAN F1). Plain SQL with pool.execute, prepared
// statements, no business logic: services validate and build the summary
// shape (D3), the comment lines (D20) and the status text (D21).
//
// Conventions (001_create_users.sql): id CHAR(36) ascii, DATETIME(3) in UTC
// stamped by the app, utf8mb4_unicode_ci. `summary` and `checklist` are JSON
// columns (MariaDB: LONGTEXT + CHECK JSON_VALID): objects are stringified on
// write and parsed on read, so callers always see the same shape.
//
// Every function takes the pool explicitly: tests point the same code at the
// test database (design §4.5).
const RECORD_COLUMNS =
  'id, task_id, owner_id, page_url, note_for_shadow, summary, checklist, ' +
  'critical_count, failed_count, opportunity_count, reviewer_id, qa_comment, ' +
  'qa_status, closed_at, closed_by, created_at, updated_at';

function toJsonColumn(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fromJsonColumn(value) {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapRecord(row) {
  return { ...row, summary: fromJsonColumn(row.summary), checklist: fromJsonColumn(row.checklist) };
}

// One row per Task ID: `taskId` is UNIQUE, so a second insert with the same
// Task ID fails with ER_DUP_ENTRY (SPEC: "no se puede guardar otro encima").
// Returns the stored record with its bugs (`bugs: []` right after insert).
export async function insert(
  pool,
  {
    id,
    taskId,
    ownerId,
    pageUrl,
    noteForShadow = null,
    summary,
    checklist = null,
    criticalCount = 0,
    failedCount = 0,
    opportunityCount = 0,
    reviewerId = null,
    qaComment = null,
    qaStatus = null,
    closedAt = null,
    closedBy = null,
    now = new Date(),
  }
) {
  await pool.execute(
    `INSERT INTO qa_records (${RECORD_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      taskId,
      ownerId,
      pageUrl,
      noteForShadow,
      toJsonColumn(summary),
      toJsonColumn(checklist),
      criticalCount,
      failedCount,
      opportunityCount,
      reviewerId,
      qaComment,
      qaStatus,
      closedAt,
      closedBy,
      now,
      now,
    ]
  );
  return findByTaskId(pool, taskId);
}

// One row per found bug (tool or manual), with its BUGS.md id: the comment
// (D20) and the severity counts (D21) are built from these rows. The
// auto-increment id preserves the reported order. `source` says where the
// bug came from — 'tool' findings survive when a QA Shadow loses the role,
// 'manual' marks are the ones cleared with an unclosed review (D9); the
// caller always states it (no default) and the ENUM validates it.
// Callers that need atomicity with `insert` open a transaction on a
// connection from the pool.
export async function insertBugs(pool, recordId, bugs) {
  if (bugs.length === 0) return;
  const values = [];
  const params = [];
  for (const bug of bugs) {
    values.push('(?, ?, ?, ?, ?, ?, ?)');
    params.push(recordId, bug.bugId, bug.source, bug.device, bug.type, bug.severity, bug.description);
  }
  await pool.execute(
    `INSERT INTO qa_record_bugs (record_id, bug_id, source, device, type, severity, description) VALUES ${values.join(', ')}`,
    params
  );
}

// Lookup for the "already saved?" check (F2 → 409) and for the Shadow review
// (F5): the record plus its bugs, or null when the Task ID is unknown.
export async function findByTaskId(pool, taskId) {
  const [rows] = await pool.execute(
    `SELECT ${RECORD_COLUMNS} FROM qa_records WHERE task_id = ?`,
    [taskId]
  );
  const row = rows[0];
  if (row === undefined) return null;
  const [bugRows] = await pool.execute(
    'SELECT id, bug_id, source, device, type, severity, description FROM qa_record_bugs WHERE record_id = ? ORDER BY id ASC',
    [row.id]
  );
  return { ...mapRecord(row), bugs: bugRows };
}

// Lookup by primary key (F3 PATCH): the record without its bugs, or null
// when the id does not exist. Authorization (owner, closed) is the service's
// job — this layer only talks SQL.
export async function findById(pool, id) {
  const [rows] = await pool.execute(`SELECT ${RECORD_COLUMNS} FROM qa_records WHERE id = ?`, [id]);
  const row = rows[0];
  return row === undefined ? null : mapRecord(row);
}

// Task ID correction (F3, spec step 4): only the Task ID and the timestamp
// move. The UNIQUE key on task_id makes a duplicate fail with ER_DUP_ENTRY,
// which the service turns into 409.
export async function updateTaskId(pool, id, taskId, now = new Date()) {
  await pool.execute('UPDATE qa_records SET task_id = ?, updated_at = ? WHERE id = ?', [taskId, now, id]);
  return findById(pool, id);
}

// Listing (F3 "Mis QA", F7): every filter is optional and applied as given —
// the month boundaries in Bolivia time (D13) are computed by the service.
// `from` is inclusive and `to` exclusive ([from, to)), newest record first.
// Bugs are not included: use findByTaskId for a single record's detail.
export async function list(pool, { ownerId, from, to } = {}) {
  const where = [];
  const params = [];
  if (ownerId !== undefined) {
    where.push('owner_id = ?');
    params.push(ownerId);
  }
  if (from !== undefined) {
    where.push('created_at >= ?');
    params.push(from);
  }
  if (to !== undefined) {
    where.push('created_at < ?');
    params.push(to);
  }
  const sql =
    `SELECT ${RECORD_COLUMNS} FROM qa_records` +
    (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY created_at DESC, id DESC';
  const [rows] = await pool.execute(sql, params);
  return rows.map(mapRecord);
}
