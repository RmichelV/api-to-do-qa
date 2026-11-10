// Save a QA record (PLAN F2 / SPEC step 3). Services never read `req`
// (§4.5): the controller passes the session user id explicitly.
//
// The rule of this phase is "one record per Task ID": a second save with the
// same Task ID answers 409 and the existing record is untouched ("no se
// puede guardar otro encima"). The owner is whoever is logged in, so the
// same Task ID can never be claimed twice by anyone.
//
// The summary is the D3 shape validated here before it reaches the JSON
// column: version + checks, each check `pass` / `fail` / `not_run` with
// counts, at most 20 items of at most 200 characters, and at most 16 KB for
// the whole record. Severity counts and review fields stay empty: they are
// filled when the QA Shadow closes the record (F5, D21).
import { randomUUID } from 'node:crypto';
import * as qaRecordRepository from '../repositories/qaRecordRepository.js';
import { AppError } from '../utils/errors.js';

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
export function toQaRecordShape(record) {
  return {
    id: record.id,
    taskId: record.task_id,
    ownerId: record.owner_id,
    pageUrl: record.page_url,
    note: record.note_for_shadow,
    summary: record.summary,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
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
      const pageUrl = requireNonEmptyString(body?.pageUrl, 'pageUrl', MAX_PAGE_URL_LENGTH);
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
  };
}
