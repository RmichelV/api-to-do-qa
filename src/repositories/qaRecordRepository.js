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
//
// Atomic guard (PLAN F5): the WHERE keeps `owner_id` and `closed_at IS
// NULL`, and the caller must check `affectedRows` — a QA closed between
// the service's read and this UPDATE simply does not match, so a closed
// record can never be edited by a concurrent close. Returns null when
// nothing matched instead of a re-read of a row we were not allowed to
// touch.
export async function updateTaskId(pool, id, taskId, ownerId, now = new Date()) {
  const [result] = await pool.execute(
    'UPDATE qa_records SET task_id = ?, updated_at = ? WHERE id = ? AND owner_id = ? AND closed_at IS NULL',
    [taskId, now, id, ownerId]
  );
  if (result.affectedRows === 0) return null;
  return findById(pool, id);
}

// D9 (PLAN F4): dropping the qa_shadow role releases the reviewer's work in
// one statement pair. Only OPEN records move (closed_at IS NULL): a closed
// review is history and is never touched. The reviewer's manual marks are
// deleted (source = 'manual') and the review itself is cleared back to
// pending — reviewer_id, checklist, qa_comment and qa_status go to NULL, so
// the record shows up in every Shadow's list again. Tool findings survive:
// they came from the run, not from the reviewer.
//
// Order matters: the DELETE reads reviewer_id through a subquery on
// qa_records, so it runs before the UPDATE clears it. `pool` is a connection
// when the caller (adminUserService) opens a transaction — every function
// here only calls .execute, so both work.
export async function releaseShadowReviews(pool, reviewerId, now = new Date()) {
  await pool.execute(
    'DELETE FROM qa_record_bugs WHERE source = ? AND record_id IN ' +
      '(SELECT id FROM qa_records WHERE reviewer_id = ? AND closed_at IS NULL)',
    ['manual', reviewerId]
  );
  const [result] = await pool.execute(
    'UPDATE qa_records SET reviewer_id = NULL, checklist = NULL, qa_comment = NULL, ' +
      'qa_status = NULL, updated_at = ? WHERE reviewer_id = ? AND closed_at IS NULL',
    [now, reviewerId]
  );
  return result.affectedRows;
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

// ---------------------------------------------------------------------
// PLAN F5 — the QA Shadow's review queue, history and review actions.
// Every function here only talks SQL: authorization (own QA, who took it,
// closed or not) is decided by the WHERE clauses plus `affectedRows`, and
// classified by the service.
// ---------------------------------------------------------------------

const RECORD_COLUMNS_PREFIXED = RECORD_COLUMNS.split(', ')
  .map((column) => `r.${column}`)
  .join(', ');

// Pending queue (D14): OPEN records of other people that are either free
// or already taken by this reviewer — never the reviewer's own (D5), never
// a closed one (D14), never one another Shadow took (D10). `taskId` is an
// exact match (the service uppercases it first). Oldest first, so the queue
// is served in the order the QAs were saved. The owner's name travels with
// each row so the screen can say whose QA it is.
export async function listPending(pool, { reviewerId, taskId } = {}) {
  const where = ['r.closed_at IS NULL', 'r.owner_id <> ?', '(r.reviewer_id IS NULL OR r.reviewer_id = ?)'];
  const params = [reviewerId, reviewerId];
  if (taskId !== undefined) {
    where.push('r.task_id = ?');
    params.push(taskId);
  }
  const [rows] = await pool.execute(
    `SELECT ${RECORD_COLUMNS_PREFIXED}, u.full_name AS owner_full_name ` +
      'FROM qa_records r INNER JOIN users u ON u.id = r.owner_id ' +
      `WHERE ${where.join(' AND ')} ORDER BY r.created_at ASC, r.id ASC`,
    params
  );
  return rows.map(mapRecord);
}

// History (D14): only the QAs this reviewer took AND closed, newest first.
export async function listHistory(pool, { reviewerId, taskId } = {}) {
  const where = ['r.reviewer_id = ?', 'r.closed_at IS NOT NULL'];
  const params = [reviewerId];
  if (taskId !== undefined) {
    where.push('r.task_id = ?');
    params.push(taskId);
  }
  const [rows] = await pool.execute(
    `SELECT ${RECORD_COLUMNS_PREFIXED}, u.full_name AS owner_full_name ` +
      'FROM qa_records r INNER JOIN users u ON u.id = r.owner_id ' +
      `WHERE ${where.join(' AND ')} ORDER BY r.closed_at DESC, r.id DESC`,
    params
  );
  return rows.map(mapRecord);
}

// "Tomar" (D10): one statement decides the claim. Only a FREE record of
// somebody else that is still open matches, so two Shadows racing the same
// QA produce exactly one affectedRows = 1; the loser's UPDATE matches
// nothing and the service answers 409. Returns the number of rows claimed.
export async function takeRecord(pool, { id, reviewerId, now = new Date() }) {
  const [result] = await pool.execute(
    'UPDATE qa_records SET reviewer_id = ?, updated_at = ? ' +
      'WHERE id = ? AND reviewer_id IS NULL AND closed_at IS NULL AND owner_id <> ?',
    [reviewerId, now, id, reviewerId]
  );
  return result.affectedRows;
}

// "Guardar avance" (F5): the review stays open and belongs to whoever took
// it — the UPDATE only matches `reviewer_id = ? AND closed_at IS NULL`, so
// a concurrent close (or another reviewer) matches nothing. The checklist
// is written as given (partial saves are the point); the optional
// qa_status / qa_comment are the Shadow's drafts (D8) and are cleared with
// the review by releaseShadowReviews (D9).
export async function updateReview(
  pool,
  { id, reviewerId, checklist, qaStatus, qaComment, now = new Date() }
) {
  const sets = ['checklist = ?', 'updated_at = ?'];
  const params = [toJsonColumn(checklist), now];
  if (qaStatus !== undefined) {
    sets.push('qa_status = ?');
    params.push(qaStatus);
  }
  if (qaComment !== undefined) {
    sets.push('qa_comment = ?');
    params.push(qaComment);
  }
  params.push(id, reviewerId);
  const [result] = await pool.execute(
    `UPDATE qa_records SET ${sets.join(', ')} WHERE id = ? AND reviewer_id = ? AND closed_at IS NULL`,
    params
  );
  return result.affectedRows;
}

// "Cerrar QA" (F5): one statement closes the record with everything the
// closure carries — checklist, generated/edited status and comment (D8),
// the severity counts (D21) and who closed it (D6: the session user). The
// guard is `reviewer_id = ? AND closed_at IS NULL`: only the reviewer who
// took it can close it, and only once. The caller writes the bug rows in
// the same transaction, after this returns 1.
export async function closeRecord(
  pool,
  {
    id,
    reviewerId,
    checklist,
    qaStatus,
    qaComment,
    criticalCount,
    failedCount,
    opportunityCount,
    closedAt = new Date(),
    now = new Date(),
  }
) {
  const [result] = await pool.execute(
    'UPDATE qa_records SET checklist = ?, qa_status = ?, qa_comment = ?, ' +
      'critical_count = ?, failed_count = ?, opportunity_count = ?, ' +
      'reviewer_id = ?, closed_at = ?, closed_by = ?, updated_at = ? ' +
      'WHERE id = ? AND reviewer_id = ? AND closed_at IS NULL',
    [
      toJsonColumn(checklist),
      qaStatus,
      qaComment,
      criticalCount,
      failedCount,
      opportunityCount,
      reviewerId,
      closedAt,
      reviewerId,
      now,
      id,
      reviewerId,
    ]
  );
  return result.affectedRows;
}

// Replace one source's bug rows of a record (D9/D20): the manual marks of
// a review are rewritten whenever the Shadow saves progress or closes, and
// the tool's findings are written once, at closure. `pool` is a connection
// when the caller opens a transaction — everything here only calls
// .execute, so both work.
export async function replaceBugs(pool, recordId, source, bugs) {
  await pool.execute('DELETE FROM qa_record_bugs WHERE record_id = ? AND source = ?', [recordId, source]);
  await insertBugs(pool, recordId, bugs);
}
