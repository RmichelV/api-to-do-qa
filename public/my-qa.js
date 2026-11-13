// "My QA" screen (PLAN F3 / SPEC step 4): the session user's own saved QA
// of the month in progress and the Task ID correction. The server owns every
// rule — it cuts the month in Bolivia time (D13), returns only the records
// the session user owns, and answers 409 when the new Task ID is taken or
// the QA is already closed (F5). The client below only renders those answers:
// only the Task ID is sent (D12), never the note or the summary.
const API = '/api/qa-records/mine';
const TASK_ID_PATTERN = /^[A-Za-z]-\d+$/;

const errorBox = document.getElementById('mq-error');
const successBox = document.getElementById('mq-success');
const rows = document.getElementById('mq-records');
const emptyBox = document.getElementById('mq-empty');
const refreshButton = document.getElementById('mq-refresh');
// D33 read-only dialog: summary per section plus the note for the Shadow.
const viewDialog = document.getElementById('mq-view-dialog');
const viewTitle = document.getElementById('mq-view-title');
const viewUrl = document.getElementById('mq-view-url');
const viewNote = document.getElementById('mq-view-note');
const viewSections = document.getElementById('mq-view-sections');
const viewClose = document.getElementById('mq-view-close');

let records = [];

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  successBox.hidden = true;
}

function showSuccess(message) {
  successBox.textContent = message;
  successBox.hidden = false;
  errorBox.hidden = true;
}

function clearFeedback() {
  errorBox.textContent = '';
  errorBox.hidden = true;
  successBox.hidden = true;
}

function redirectToLogin() {
  window.location.href = '/login.html';
}

// The API stores UTC (design §4): only append "Z" when there is no zone.
function formatDate(value) {
  if (!value) return '—';
  const raw = String(value);
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
}

function actionButton(label, action, variant = 'ctrl-btn--link') {
  const button = document.createElement('button');
  button.type = 'button';
  // .ctrl-btn alone has no background and white text: always pair it with a
  // colour modifier from styles.css.
  button.className = `ctrl-btn ${variant}`;
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

function taskIdCell(record) {
  const cell = document.createElement('td');
  cell.dataset.role = 'task-id';
  const value = document.createElement('span');
  value.className = 'myqa-task-id';
  value.textContent = record.taskId;
  cell.append(value);
  if (!record.closedAt) {
    cell.append(actionButton('Edit Task ID', 'edit'));
  }
  return cell;
}

function statusCell(record) {
  const cell = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = `admin-badge ${record.closedAt ? 'admin-badge--closed' : 'admin-badge--on'}`;
  badge.textContent = record.closedAt ? 'Closed' : 'Open';
  cell.append(badge);
  return cell;
}

// D33: every row can open the read-only view of its saved QA.
function actionCell() {
  const cell = document.createElement('td');
  cell.className = 'admin-row';
  cell.append(actionButton('Ver', 'ver'));
  return cell;
}

function buildRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record.id;

  const page = document.createElement('td');
  // Defense in depth: the server only stores http(s) URLs, but a link is
  // built only for those; anything else is shown as plain text.
  if (/^https?:\/\//i.test(record.pageUrl)) {
    const link = document.createElement('a');
    link.href = record.pageUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.textContent = record.pageUrl;
    page.append(link);
  } else {
    page.textContent = record.pageUrl;
  }

  const saved = document.createElement('td');
  saved.textContent = formatDate(record.createdAt);

  row.append(taskIdCell(record), page, saved, statusCell(record), actionCell());
  return row;
}

function render() {
  rows.replaceChildren(...records.map(buildRow));
  emptyBox.hidden = records.length > 0;
}

// Inline editor: the Task ID cell becomes an input with Save / Cancel. Only
// this cell ever changes; the note and the summary are read-only (D12).
function startEdit(row, record) {
  const cell = row.querySelector('[data-role="task-id"]');
  if (!cell) return;

  const editor = document.createElement('div');
  editor.className = 'admin-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = record.taskId;
  input.setAttribute('aria-label', `Task ID for ${record.taskId}`);
  input.autocomplete = 'off';

  const save = actionButton('Save', 'save', 'ctrl-btn--pdf');
  const cancel = actionButton('Cancel', 'cancel', 'ctrl-btn--reset');
  editor.append(input, save, cancel);

  cell.replaceChildren(editor);
  input.focus();
  input.select();

  const cancelEdit = () => render();
  cancel.addEventListener('click', cancelEdit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancelEdit();
    if (event.key === 'Enter') save.click();
  });
  save.addEventListener('click', () => patchTaskId(record, input.value, save, cancel));
}

async function patchTaskId(record, rawTaskId, saveButton, cancelButton) {
  const taskId = rawTaskId.trim().toUpperCase();
  clearFeedback();
  if (!TASK_ID_PATTERN.test(taskId)) {
    showError('A Task ID looks like D-147856: one letter, a dash and numbers.');
    return;
  }

  saveButton.disabled = true;
  cancelButton.disabled = true;
  try {
    const response = await fetch(`/api/qa-records/${record.id}`, {
      method: "PATCH",
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
    const body = await response.json().catch(() => null);
    if (response.status === 401 && body?.error === 'unauthenticated') {
      redirectToLogin();
      return;
    }
    if (!response.ok) {
      // The server already says why (409 taken / 409 closed / 400 format).
      showError(body?.message ?? `The server answered ${response.status}.`);
      return;
    }
    showSuccess(`Task ID updated to ${body?.record?.taskId ?? taskId}.`);
    await loadRecords();
  } finally {
    saveButton.disabled = false;
    cancelButton.disabled = false;
  }
}

// ── D33: read-only view of the saved QA ────────────────────────────────
// The list already carries `summary` and `note`, so the view never asks the
// server again. Every string reaches the DOM through textContent: saved
// summaries and notes are user data and are never parsed as HTML.
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

// One line per finding: `bugId · type · severity · device · text`. A string
// finding is shown as-is; an object without those fields falls back to its
// own key/value pairs instead of a row of dashes.
function findingLine(item) {
  if (typeof item === 'string') return item;
  if (!isPlainObject(item)) return String(item);
  const fields = [item.bugId, item.type, item.severity, item.device, item.text];
  const hasFields = fields.some((value) => value !== null && value !== undefined && value !== '');
  if (!hasFields) {
    return Object.entries(item)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
  }
  return fields.map(fieldOrDash).join(' · ');
}

function statusBadgeClass(status) {
  if (status === 'pass') return 'admin-badge--on';
  if (status === 'fail') return 'admin-badge--off';
  return 'admin-badge--closed';
}

function textParagraph(className, text) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

// One block per section: name + status badge, the result line the panel
// shows and its findings. A section without findings only shows the result.
function buildSection(name, check) {
  const section = document.createElement('section');
  section.className = 'myqa-section';

  const heading = document.createElement('h4');
  const label = document.createElement('span');
  label.className = 'myqa-section__name';
  label.textContent = name;
  const badge = document.createElement('span');
  badge.className = `admin-badge ${statusBadgeClass(check?.status)}`;
  badge.textContent = fieldOrDash(check?.status);
  heading.append(label, badge);
  section.append(heading);

  if (check?.result) section.append(textParagraph('myqa-section__result', String(check.result)));

  const items = Array.isArray(check?.items) ? check.items : [];
  if (items.length > 0) {
    const list = document.createElement('ul');
    list.className = 'myqa-findings';
    for (const item of items) {
      const entry = document.createElement('li');
      entry.textContent = findingLine(item);
      list.append(entry);
    }
    section.append(list);
  }
  return section;
}

function openView(record) {
  viewTitle.textContent = record.taskId;
  viewUrl.textContent = record.pageUrl;
  viewNote.textContent = record.note
    ? String(record.note)
    : 'No note was left for the QA Shadow.';

  const checks = record.summary?.checks;
  const sections = isPlainObject(checks)
    ? Object.entries(checks).map(([name, check]) => buildSection(name, check))
    : [textParagraph('admin-empty', 'This QA has no saved summary.')];
  viewSections.replaceChildren(...sections);

  if (typeof viewDialog.showModal === 'function') viewDialog.showModal();
  else viewDialog.setAttribute('open', '');
}

viewClose.addEventListener('click', () => {
  if (typeof viewDialog.close === 'function') viewDialog.close();
  else viewDialog.removeAttribute('open');
});

rows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr');
  const record = records.find((entry) => entry.id === row?.dataset.id);
  if (!record) return;

  if (button.dataset.action === 'edit') startEdit(row, record);
  if (button.dataset.action === 'ver') openView(record);
});

async function loadRecords() {
  const response = await fetch("/api/qa-records/mine");
  const body = await response.json().catch(() => null);
  if (response.status === 401 && body?.error === 'unauthenticated') {
    redirectToLogin();
    return;
  }
  if (!response.ok) {
    showError(body?.message ?? `The server answered ${response.status}.`);
    return;
  }
  records = body?.records ?? [];
  render();
}

refreshButton.addEventListener('click', () => {
  clearFeedback();
  loadRecords();
});

loadRecords();
