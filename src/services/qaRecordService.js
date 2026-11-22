// Save a QA record (PLAN F2 / SPEC step 3) and manage it afterwards (PLAN
// F3 / SPEC step 4: the owner's month list and the Task ID correction) and
// the QA Shadow's review (PLAN F5: queue, history, take, save progress and
// close). Services never read `req` (§4.5): the controller passes the
// session user id explicitly.
//
// The rule of the first phases is "one record per Task ID": a second save
// with the same Task ID answers 409 and the existing record is untouched
// ("no se puede guardar otro encima"). The owner is whoever is logged in,
// so the same Task ID can never be claimed twice by anyone.
//
// The summary is the D3 shape validated here before it reaches the JSON
// column: version + checks, each check `pass` / `fail` / `not_run` with
// counts, at most 20 items of at most 200 characters, and at most 16 KB for
// the whole record.
//
// F5 rule: taking, saving progress and closing are decided by one guarded
// UPDATE and its `affectedRows` — never by a read taken beforehand — so a
// concurrent close or a second Shadow always loses the race cleanly (D10).
// The status and the comment of a closure come from the server's BUGS.md
// catalog (qaBugCatalog.js, D7/D20/D21), not from what the browser sends.
import { randomUUID } from 'node:crypto';
import * as qaRecordRepository from '../repositories/qaRecordRepository.js';
import { AppError } from '../utils/errors.js';
import {
  MANUAL_CHECKLIST,
  CHECKLIST_VALUES,
  BUG_DEVICES,
  manualBugsFromChecklist,
  toolBugsFromSummary,
  statusAndCommentFromBugs,
} from './qaBugCatalog.js';

// D22: one letter, a dash and numbers, e.g. "D-147856" (the numbers may grow
// in length). Stored uppercase so `d-147856` and `D-147856` are the same
// Task ID.
const TASK_ID_PATTERN = /^[A-Za-z]-\d+$/;
const MAX_TASK_ID_LENGTH = 50; // column task_id VARCHAR(50)
const MAX_PAGE_URL_LENGTH = 2048; // column page_url VARCHAR(2048)
const MAX_NOTE_LENGTH = 2000; // bounded so a note never blows up TEXT
const MAX_SUMMARY_BYTES = 16 * 1024; // D3: 16 KB per record
const CHECK_STATUSES = Object.freeze(['pass', 'fail', 'not_run']);
const MAX_ITEMS_PER_CHECK = 20; // D3
const MAX_ITEM_LENGTH = 200; // D3
const MAX_QA_STATUS_LENGTH = 255; // column qa_status VARCHAR(255)
const MAX_QA_COMMENT_LENGTH = 4000; // free-text bound; the generated one is bounded by D3

function assertNoUnknownFields(body, allowed) {
  const unknown = Object.keys(body ?? {}).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new AppError(400, 'validation_error', `Unknown fields: ${unknown.join(', ')}.`);
  }
}

function requireNonEmptyString(value, field, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'validation_error', `${field} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new AppError(400, 'validation_error', `${field} must be at most ${maxLength} characters.`);
  }
  return trimmed;
}

// The page URL is rendered as a link in every QA view: only absolute
// http(s) URLs are accepted, so javascript:/data: URLs never get stored.
function assertPageUrl(value) {
  const pageUrl = requireNonEmptyString(value, 'pageUrl', MAX_PAGE_URL_LENGTH);
  let protocol;
  try {
    protocol = new URL(pageUrl).protocol;
  } catch {
    protocol = null;
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new AppError(400, 'validation_error', 'pageUrl must be an http or https URL.');
  }
  return pageUrl;
}

// D22: one letter, dash, digits; stored uppercase.
function assertTaskId(value) {
  const taskId = requireNonEmptyString(value, 'taskId', MAX_TASK_ID_LENGTH);
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new AppError(
      400,
      'validation_error',
      'taskId must look like D-147856: one letter, a dash and numbers.'
    );
  }
  return taskId.toUpperCase();
}

function assertNote(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new AppError(400, 'validation_error', 'note must be a string.');
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw new AppError(400, 'validation_error', `note must be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  return trimmed;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// F5 checklist (D15/D19/D24): a map of manual BUGS.md item → passed / bug /
// n/a. Unknown items are rejected — the manual checklist is the F0 table,
// never the "QA Todo List" of index.html. `complete` (close) requires every
// item; a partial save keeps whatever the Shadow already marked.
function assertChecklist(value, { complete }) {
  if (!isPlainObject(value)) {
    throw new AppError(400, 'validation_error', 'checklist must be an object.');
  }
  const unknown = Object.keys(value).filter((item) => !MANUAL_CHECKLIST.includes(item));
  if (unknown.length > 0) {
    throw new AppError(
      400,
      'validation_error',
      `checklist has items that are not in the manual BUGS.md checklist: ${unknown.join(', ')}.`
    );
  }
  if (complete) {
    const missing = MANUAL_CHECKLIST.filter((item) => !(item in value));
    if (missing.length > 0) {
      throw new AppError(
        400,
        'validation_error',
        `checklist must cover every manual item before closing (D24): missing ${missing.join(', ')}.`
      );
    }
  }
  for (const [item, state] of Object.entries(value)) {
    if (!CHECKLIST_VALUES.includes(state)) {
      throw new AppError(
        400,
        'validation_error',
        `checklist.${item} must be one of: ${CHECKLIST_VALUES.join(', ')}.`
      );
    }
  }
  return value;
}

// D21: the Shadow picks the device (M, D or M/D) of every item they mark
// as Bug. The map may only name manual items and only valid devices.
function assertBugDevices(value, checklist) {
  const devices = value === undefined || value === null ? {} : value;
  if (!isPlainObject(devices)) {
    throw new AppError(400, 'validation_error', 'bugDevices must be an object.');
  }
  const unknown = Object.keys(devices).filter((item) => !MANUAL_CHECKLIST.includes(item));
  if (unknown.length > 0) {
    throw new AppError(400, 'validation_error', `bugDevices has unknown items: ${unknown.join(', ')}.`);
  }
  for (const [item, device] of Object.entries(devices)) {
    if (!BUG_DEVICES.includes(device)) {
      throw new AppError(400, 'validation_error', `bugDevices.${item} must be one of: ${BUG_DEVICES.join(', ')}.`);
    }
  }
  const withoutDevice = Object.entries(checklist)
    .filter(([item, state]) => state === 'bug' && !(item in devices))
    .map(([item]) => item);
  if (withoutDevice.length > 0) {
    throw new AppError(
      400,
      'validation_error',
      `bugDevices is required for every item marked as bug (D21): ${withoutDevice.join(', ')}.`
    );
  }
  return devices;
}

// D8: the Shadow may edit the generated status and comment before closing.
function assertQaStatus(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(400, 'validation_error', 'qaStatus must be a non-empty string.');
  }
  const status = value.trim();
  if (status.length > MAX_QA_STATUS_LENGTH) {
    throw new AppError(400, 'validation_error', `qaStatus must be at most ${MAX_QA_STATUS_LENGTH} characters.`);
  }
  return status;
}

function assertQaComment(value) {
  if (value === null) return null; // explicitly clearing the generated one (D8)
  if (typeof value !== 'string') {
    throw new AppError(400, 'validation_error', 'qaComment must be a string.');
  }
  const comment = value.trim();
  if (comment === '') return null;
  if (comment.length > MAX_QA_COMMENT_LENGTH) {
    throw new AppError(400, 'validation_error', `qaComment must be at most ${MAX_QA_COMMENT_LENGTH} characters.`);
  }
  return comment;
}

// Task ID of a query string: absent or empty means "no filter", anything
// malformed is a 400 (same rule as saving, D22).
function taskIdFilter(taskId) {
  if (taskId === undefined || taskId === null || taskId === '') return undefined;
  return assertTaskId(taskId);
}

// `items` (findings) and `found` (what the check saw, D32) share the D3 caps.
function assertItems(items, checkName, field = 'items') {
  if (items === undefined) return undefined;
  if (!Array.isArray(items)) {
    throw new AppError(400, 'validation_error', `summary.checks.${checkName}.${field} must be an array.`);
  }
  if (items.length > MAX_ITEMS_PER_CHECK) {
    throw new AppError(
      400,
      'validation_error',
      `summary.checks.${checkName}.${field} must have at most ${MAX_ITEMS_PER_CHECK} entries.`
    );
  }
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.length > MAX_ITEM_LENGTH) {
        throw new AppError(
          400,
          'validation_error',
          `summary.checks.${checkName}.${field} entries must be at most ${MAX_ITEM_LENGTH} characters.`
        );
      }
      continue;
    }
    if (!isPlainObject(item)) {
      throw new AppError(
        400,
        'validation_error',
        `summary.checks.${checkName}.${field} entries must be strings or objects.`
      );
    }
    if (Buffer.byteLength(JSON.stringify(item), 'utf8') > MAX_ITEM_LENGTH * 4) {
      throw new AppError(
        400,
        'validation_error',
        `summary.checks.${checkName}.${field} entries are too large.`
      );
    }
  }
  return items;
}

// D32: the one-line result the check's panel shows.
function assertResult(value, checkName) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > MAX_ITEM_LENGTH) {
    throw new AppError(
      400,
      'validation_error',
      `summary.checks.${checkName}.result must be a string of at most ${MAX_ITEM_LENGTH} characters.`
    );
  }
  return value;
}

function assertCount(value, field, checkName) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      400,
      'validation_error',
      `summary.checks.${checkName}.${field} must be a non-negative integer.`
    );
  }
  return value;
}

function assertCheck(check, checkName) {
  if (!isPlainObject(check)) {
    throw new AppError(400, 'validation_error', `summary.checks.${checkName} must be an object.`);
  }
  if (!CHECK_STATUSES.includes(check.status)) {
    throw new AppError(
      400,
      'validation_error',
      `summary.checks.${checkName}.status must be one of: ${CHECK_STATUSES.join(', ')}.`
    );
  }
  const shape = { status: check.status };
  const result = assertResult(check.result, checkName);
  if (result !== undefined) shape.result = result;
  const found = assertItems(check.found, checkName, 'found');
  if (found !== undefined) shape.found = found;
  const total = assertCount(check.total, 'total', checkName);
  const failed = assertCount(check.failed, 'failed', checkName);
  if (total !== undefined) shape.total = total;
  if (failed !== undefined) shape.failed = failed;
  if (failed !== undefined && total !== undefined && failed > total) {
    throw new AppError(
      400,
      'validation_error',
      `summary.checks.${checkName}.failed cannot be greater than total.`
    );
  }
  const items = assertItems(check.items, checkName);
  if (items !== undefined) shape.items = items;
  // Carry over any extra informational field the tool adds later (bugId…)
  // instead of silently dropping it: only the fields above are validated.
  for (const [key, value] of Object.entries(check)) {
    if (!(key in shape)) shape[key] = value;
  }
  return shape;
}

// D3: { version, ranAt, checks } with the per-check limits above.
function assertSummary(value) {
  if (!isPlainObject(value)) {
    throw new AppError(400, 'validation_error', 'summary must be an object.');
  }
  if (value.version !== 1) {
    throw new AppError(400, 'validation_error', 'summary.version must be 1.');
  }
  if (!isPlainObject(value.checks)) {
    throw new AppError(400, 'validation_error', 'summary.checks must be an object.');
  }
  if (value.ranAt !== undefined && value.ranAt !== null && typeof value.ranAt !== 'string') {
    throw new AppError(400, 'validation_error', 'summary.ranAt must be an ISO date string.');
  }

  const checks = {};
  for (const [name, check] of Object.entries(value.checks)) {
    checks[name] = assertCheck(check, name);
  }

  const summary = { version: 1, checks };
  if (value.ranAt !== undefined) summary.ranAt = value.ranAt;
  for (const [key, extra] of Object.entries(value)) {
    if (!(key in summary)) summary[key] = extra;
  }

  const bytes = Buffer.byteLength(JSON.stringify(summary), 'utf8');
  if (bytes > MAX_SUMMARY_BYTES) {
    throw new AppError(
      400,
      'validation_error',
      `summary must be at most ${MAX_SUMMARY_BYTES / 1024} KB.`
    );
  }
  return summary;
}

// Public shape: only what saving produces. Review fields (checklist, status,
// comment) are added by F5/F6 and must not leak before the record is closed.
// `closedAt` is what F3 uses to know whether the Task ID is still editable.
export function toQaRecordShape(record) {
  return {
    id: record.id,
    taskId: record.task_id,
    ownerId: record.owner_id,
    pageUrl: record.page_url,
    note: record.note_for_shadow,
    summary: record.summary,
    closedAt: record.closed_at,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

// F5: what the Shadow sees — the owner's name (the queue says whose QA it
// is) and who holds the review right now.
export function toShadowShape(record) {
  return {
    ...toQaRecordShape(record),
    ownerFullName: record.owner_full_name ?? null,
    reviewerId: record.reviewer_id ?? null,
  };
}

// F5: the review fields, for the Shadow's own history and for the answers
// to save/close. Never served to the owner before the closure (D10, F6).
export function toShadowReviewShape(record) {
  return {
    ...toShadowShape(record),
    checklist: record.checklist ?? null,
    qaStatus: record.qa_status ?? null,
    qaComment: record.qa_comment ?? null,
    criticalCount: record.critical_count,
    failedCount: record.failed_count,
    opportunityCount: record.opportunity_count,
    closedBy: record.closed_by ?? null,
  };
}

// D13: the month is cut in Bolivia time — America/La_Paz is UTC-4 with no
// daylight saving, so the local month runs from 04:00 UTC on day 1 to 04:00
// UTC on day 1 of the next month. Shifting "now" by -4h and reading the UTC
// fields gives the local calendar date without a timezone library.
export function boliviaMonthRange(now = new Date()) {
  const BOLIVIA_OFFSET_MS = -4 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + BOLIVIA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  return {
    from: new Date(Date.UTC(year, month, 1, 4)),
    to: new Date(Date.UTC(year, month + 1, 1, 4)),
  };
}

// Runs one guarded review UPDATE plus the bug rows it authorizes inside a
// single transaction (F5). Returns 0 when the guard matched nothing — the
// transaction rolled back and nothing was written — so the record and its
// bugs can never disagree. `pool` is the real pool: every repository
// function only calls .execute, so a connection works the same.
async function withReviewWrite(pool, write) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const affected = await write(connection);
    if (affected === 0) {
      await connection.rollback();
      return 0;
    }
    await connection.commit();
    return affected;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // The connection may already be unusable; nothing else to clean up.
    }
    throw error;
  } finally {
    connection.release();
  }
}

// Why the atomic take matched nothing. The decision always comes from the
// UPDATE's affectedRows; this only reads the row to explain the refusal.
// Returns null when the QA is already this reviewer's (a repeated "Tomar"
// is a no-op, not a conflict).
async function takeRefusal(pool, id, reviewerId) {
  const record = await qaRecordRepository.findById(pool, id);
  if (!record) return new AppError(404, 'not_found', 'QA record not found.');
  if (record.owner_id === reviewerId) {
    return new AppError(403, 'forbidden', 'You cannot review your own QA (D5).');
  }
  if (record.closed_at) {
    return new AppError(409, 'record_closed', 'This QA was already closed.');
  }
  if (record.reviewer_id === reviewerId) return null; // already mine
  return new AppError(409, 'already_taken', 'Another QA Shadow took this QA first.');
}

// Why the atomic save/close matched nothing. Order matters: own QA is 403
// (D5) before any 409, and a closed record is 409 for everybody (D10).
// Returns null only when the record is still open and still this
// reviewer's — the UPDATE simply had nothing left to change.
async function reviewRefusal(pool, id, reviewerId) {
  const record = await qaRecordRepository.findById(pool, id);
  if (!record) return new AppError(404, 'not_found', 'QA record not found.');
  if (record.owner_id === reviewerId) {
    return new AppError(403, 'forbidden', 'You cannot review your own QA (D5).');
  }
  if (record.closed_at) {
    return new AppError(409, 'record_closed', 'This QA was closed by the QA Shadow and can no longer be edited.');
  }
  if (record.reviewer_id && record.reviewer_id !== reviewerId) {
    return new AppError(403, 'forbidden', 'Another QA Shadow is reviewing this QA.');
  }
  if (!record.reviewer_id) {
    return new AppError(409, 'not_taken', 'Take this QA before saving a review on it.');
  }
  return null; // mine and open: nothing to change, not an error
}

export function createQaRecordService({ pool }) {
  return {
    // POST /api/qa-records. Returns the created record; 409 when the Task
    // ID is already taken, 400 when the payload does not match the shape.
    async createQaRecord({ body, ownerId }) {
      assertNoUnknownFields(body, ['taskId', 'pageUrl', 'note', 'summary']);
      if (!ownerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to save a QA.');
      }
      const taskId = assertTaskId(body?.taskId);
      const pageUrl = assertPageUrl(body?.pageUrl);
      const note = assertNote(body?.note);
      const summary = assertSummary(body?.summary);

      if (await qaRecordRepository.findByTaskId(pool, taskId)) {
        throw new AppError(
          409,
          'task_id_exists',
          `Task ID ${taskId} already has a saved QA. Nothing was overwritten.`
        );
      }

      try {
        const created = await qaRecordRepository.insert(pool, {
          id: randomUUID(),
          taskId,
          ownerId,
          pageUrl,
          noteForShadow: note,
          summary,
        });
        return toQaRecordShape(created);
      } catch (error) {
        // Unique key race with a concurrent save of the same Task ID.
        if (error?.code === 'ER_DUP_ENTRY') {
          throw new AppError(
            409,
            'task_id_exists',
            `Task ID ${taskId} already has a saved QA. Nothing was overwritten.`
          );
        }
        throw error;
      }
    },

    // GET /api/qa-records/mine (F3): the session user's own records of the
    // month in progress, cut in Bolivia time (D13) and ordered by save date.
    // Only the owner ever sees their own list; the role is irrelevant, so
    // qa_engineer and qa_shadow work exactly the same (D5).
    async listMine({ ownerId }) {
      if (!ownerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to see your saved QA.');
      }
      const { from, to } = boliviaMonthRange();
      const records = await qaRecordRepository.list(pool, { ownerId, from, to });
      return records.map(toQaRecordShape);
    },

    // PATCH /api/qa-records/:id (F3, spec step 4): only the Task ID can be
    // corrected, only by the owner, only while the QA is open (F5 closes it).
    // Anything else answers 404/409/400 and leaves the record untouched.
    async updateTaskId({ id, ownerId, body }) {
      assertNoUnknownFields(body, ['taskId']); // D12: the note and the summary are not editable
      if (!ownerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to edit a QA.');
      }
      const taskId = assertTaskId(body?.taskId);

      const record = await qaRecordRepository.findById(pool, id);
      // Not found and "not yours" answer the same way: no existence leak.
      if (!record || record.owner_id !== ownerId) {
        throw new AppError(404, 'not_found', 'QA record not found.');
      }
      if (record.closed_at) {
        throw new AppError(
          409,
          'record_closed',
          'This QA was closed by the QA Shadow and can no longer be edited.'
        );
      }
      // Correcting it to the value it already has is a no-op, not a conflict.
      if (record.task_id === taskId) return toQaRecordShape(record);

      if (await qaRecordRepository.findByTaskId(pool, taskId)) {
        throw new AppError(
          409,
          'task_id_exists',
          `Task ID ${taskId} already has a saved QA. Nothing was changed.`
        );
      }

      try {
        // Atomic guard (F5): the UPDATE only matches an OPEN row of this
        // owner, so a QA closed between the read above and here simply does
        // not move — a closed record can never be edited by a race.
        const updated = await qaRecordRepository.updateTaskId(pool, id, taskId, ownerId);
        if (!updated) {
          const current = await qaRecordRepository.findById(pool, id);
          if (!current || current.owner_id !== ownerId) {
            throw new AppError(404, 'not_found', 'QA record not found.');
          }
          if (current.closed_at) {
            throw new AppError(
              409,
              'record_closed',
              'This QA was closed by the QA Shadow and can no longer be edited.'
            );
          }
          // Still open and still theirs: a concurrent writer stored the very
          // same Task ID meanwhile, so there is nothing left to change.
          return toQaRecordShape(current);
        }
        return toQaRecordShape(updated);
      } catch (error) {
        // Unique key race: another save claimed the Task ID meanwhile.
        if (error?.code === 'ER_DUP_ENTRY') {
          throw new AppError(
            409,
            'task_id_exists',
            `Task ID ${taskId} already has a saved QA. Nothing was changed.`
          );
        }
        throw error;
      }
    },

    // F5 pending queue (D14): other people's open QAs, optionally filtered
    // by an exact Task ID. Never the Shadow's own (D5), never a closed one
    // (D14), never one another Shadow took (D10) — all three are in the
    // WHERE clause, not in a filter applied afterwards.
    async listPending({ reviewerId, taskId }) {
      if (!reviewerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to see the pending QA.');
      }
      const filter = taskIdFilter(taskId);
      const records = await qaRecordRepository.listPending(pool, { reviewerId, taskId: filter });
      return records.map(toShadowShape);
    },

    // F5 history (D14): only the QAs this Shadow took and closed, with the
    // same Task ID search.
    async listHistory({ reviewerId, taskId }) {
      if (!reviewerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to see your review history.');
      }
      const filter = taskIdFilter(taskId);
      const records = await qaRecordRepository.listHistory(pool, { reviewerId, taskId: filter });
      return records.map(toShadowReviewShape);
    },

    // F5 "Tomar" (D10): one guarded UPDATE decides the claim. Exactly one
    // of two racing Shadows gets affectedRows = 1; the other is classified
    // here and answers 409.
    async takeQa({ id, reviewerId }) {
      if (!reviewerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to take a QA.');
      }
      const affected = await qaRecordRepository.takeRecord(pool, { id, reviewerId });
      if (affected === 0) {
        const refusal = await takeRefusal(pool, id, reviewerId);
        if (refusal) throw refusal;
      }
      const record = await qaRecordRepository.findById(pool, id);
      if (!record) {
        throw new AppError(404, 'not_found', 'QA record not found.');
      }
      return toShadowShape(record);
    },

    // F5 "Guardar avance" (D10/D19): the reviewer keeps their open work —
    // a partial checklist, the devices of the bugs they marked and optional
    // status/comment drafts (D8) — without closing anything. The guarded
    // UPDATE (reviewer_id + closed_at IS NULL) plus the manual bug rows run
    // in one transaction; the QA stays out of every queue but its owner's
    // history.
    async saveReview({ id, reviewerId, body }) {
      if (!reviewerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to review a QA.');
      }
      assertNoUnknownFields(body, ['checklist', 'bugDevices', 'qaStatus', 'qaComment']);
      const checklist = assertChecklist(body?.checklist, { complete: false });
      const bugDevices = assertBugDevices(body?.bugDevices, checklist);
      const qaStatus = body?.qaStatus !== undefined ? assertQaStatus(body.qaStatus) : undefined;
      const qaComment = body?.qaComment !== undefined ? assertQaComment(body.qaComment) : undefined;

      const manualBugs = manualBugsFromChecklist(checklist, bugDevices);
      const affected = await withReviewWrite(pool, async (connection) => {
        const rows = await qaRecordRepository.updateReview(connection, {
          id,
          reviewerId,
          checklist,
          qaStatus,
          qaComment,
        });
        if (rows === 0) return 0;
        await qaRecordRepository.replaceBugs(connection, id, 'manual', manualBugs);
        return rows;
      });
      if (affected === 0) {
        const refusal = await reviewRefusal(pool, id, reviewerId);
        if (refusal) throw refusal;
      }
      const record = await qaRecordRepository.findById(pool, id);
      if (!record) {
        throw new AppError(404, 'not_found', 'QA record not found.');
      }
      return toShadowReviewShape(record);
    },

    // F5 "Cerrar QA" (D6, D7, D8, D20, D21, D24, D25): the whole manual
    // checklist must be closed, the bugs come from the server's BUGS.md
    // catalog — the tool's findings from the saved summary plus every item
    // marked as bug — and from them the status and the comment are
    // generated. The Shadow may edit both (D8) before confirming. One
    // guarded UPDATE (reviewer_id + closed_at IS NULL) and the bug rows
    // share a transaction: the record closes with everything it needs or
    // not at all, and the closer is the session user (D6).
    async closeReview({ id, reviewerId, body }) {
      if (!reviewerId) {
        throw new AppError(401, 'unauthenticated', 'Sign in to close a QA.');
      }
      assertNoUnknownFields(body, ['checklist', 'bugDevices', 'qaStatus', 'qaComment']);
      // The record must exist: its summary feeds the tool bugs. Whether it
      // may be closed is still decided by the guarded UPDATE below.
      const existing = await qaRecordRepository.findById(pool, id);
      if (!existing) {
        throw new AppError(404, 'not_found', 'QA record not found.');
      }

      const checklist = assertChecklist(body?.checklist, { complete: true }); // D24
      const bugDevices = assertBugDevices(body?.bugDevices, checklist);
      const editedStatus = body?.qaStatus !== undefined ? assertQaStatus(body.qaStatus) : undefined;
      const editedComment = body?.qaComment !== undefined ? assertQaComment(body.qaComment) : undefined;

      const bugs = [
        ...toolBugsFromSummary(existing.summary),
        ...manualBugsFromChecklist(checklist, bugDevices),
      ];
      const generated = statusAndCommentFromBugs(bugs); // D21, D25, D20
      const qaStatus = editedStatus ?? generated.status;
      const qaComment = editedComment !== undefined ? editedComment : generated.comment;

      const affected = await withReviewWrite(pool, async (connection) => {
        const rows = await qaRecordRepository.closeRecord(connection, {
          id,
          reviewerId,
          checklist,
          qaStatus,
          qaComment,
          criticalCount: generated.counts.critical,
          failedCount: generated.counts.failed,
          opportunityCount: generated.counts.opportunity,
        });
        if (rows === 0) return 0;
        // Insertion order = comment order (F1): tool findings first, then
        // the manual marks, replacing whatever a draft save left behind.
        await qaRecordRepository.replaceBugs(
          connection,
          id,
          'tool',
          bugs.filter((bug) => bug.source === 'tool')
        );
        await qaRecordRepository.replaceBugs(
          connection,
          id,
          'manual',
          bugs.filter((bug) => bug.source === 'manual')
        );
        return rows;
      });
      if (affected === 0) {
        const refusal = await reviewRefusal(pool, id, reviewerId);
        if (refusal) throw refusal;
      }
      const record = await qaRecordRepository.findById(pool, id);
      if (!record) {
        throw new AppError(404, 'not_found', 'QA record not found.');
      }
      return toShadowReviewShape(record);
    },
  };
}
