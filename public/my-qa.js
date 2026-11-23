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
  cell.className = 'qa-nowrap';
  cell.dataset.role = 'task-id';
  const value = document.createElement('span');
  value.className = 'myqa-task-id';
  value.textContent = record.taskId;
  cell.append(value);
  if (!record.closedAt) {
    const wrap = document.createElement('div');
    wrap.className = 'qa-actions qa-actions--below';
    wrap.append(actionButton('Edit Task ID', 'edit'));
    cell.append(wrap);
  }
  return cell;
}

function statusCell(record) {
  const cell = document.createElement('td');
  cell.className = 'qa-nowrap';
  const badge = document.createElement('span');
  badge.className = `admin-badge ${record.closedAt ? 'admin-badge--closed' : 'admin-badge--on'}`;
  badge.textContent = record.closedAt ? 'Closed' : 'Open';
  cell.append(badge);
  return cell;
}

// D33: every row can open the read-only view of its saved QA.
function actionCell() {
  const cell = document.createElement('td');
  cell.className = 'qa-nowrap';
  const wrap = document.createElement('div');
  wrap.className = 'qa-actions';
  wrap.append(actionButton('Ver', 'ver'));
  cell.append(wrap);
  return cell;
}

function buildRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record.id;

  const page = document.createElement('td');
  page.append(QaView.pageLink(record.pageUrl));

  const saved = document.createElement('td');
  saved.className = 'qa-nowrap';
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
// server again. Sections and findings are drawn by QaView (qa-view.js),
// the same renderer as the QA Shadow screen; every string reaches the DOM
// through textContent, never as HTML.
function textParagraph(className, text) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

// One block per section: readable name + status, the result line the
// panel shows and its findings (bugId · severity · device chips + text).
function buildSection(name, check) {
  const section = document.createElement('section');
  section.className = 'myqa-section';
  section.append(QaView.sectionHeading(name, check));

  if (check?.result) section.append(textParagraph('myqa-section__result', String(check.result)));

  const items = Array.isArray(check?.items) ? check.items : [];
  if (items.length > 0) {
    const list = document.createElement('ul');
    list.className = 'myqa-findings';
    for (const item of items) {
      const entry = document.createElement('li');
      entry.append(QaView.findingContent(item));
      list.append(entry);
    }
    section.append(list);
  }
  return section;
}

function openView(record) {
  viewTitle.textContent = record.taskId;
  viewUrl.replaceChildren(QaView.pageLink(record.pageUrl, { compact: false }));
  viewNote.textContent = record.note
    ? String(record.note)
    : 'No note was left for the QA Shadow.';
  viewNote.classList.toggle('admin-note', !record.note);

  const checks = record.summary?.checks;
  if (QaView.isPlainObject(checks)) {
    // Failed sections first: that is what the reader is looking for.
    const entries = Object.entries(checks).sort(
      ([nameA, a], [nameB, b]) => QaView.statusRank(nameA, a) - QaView.statusRank(nameB, b)
    );
    const grid = document.createElement('div');
    grid.className = 'qa-sections';
    grid.append(...entries.map(([name, check]) => buildSection(name, check)));
    viewSections.replaceChildren(QaView.overview(checks), grid);
  } else {
    viewSections.replaceChildren(textParagraph('admin-empty', 'This QA has no saved summary.'));
  }

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
