// Admin users screen (plan T9b, specs S1/S5/S13, design §7.2): a thin client
// over GET/POST /api/admin/users, PATCH /api/admin/users/:id and
// POST /api/admin/users/:id/reset-password. The server owns every rule:
// requireRole('admin') protects this page and that API, and the guards
// (409 last_admin, 409 self_change, 409 email_exists) are shown as they come
// back, with a short hint on what to do next. The client checks below are
// for usability only; the API is the authority.
const API = '/api/admin/users';
const ROLES = ['admin', 'qa_engineer'];
const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

// Next step per API error code; the server message always comes first.
const ERROR_HINTS = {
  last_admin: 'Promote another active admin first, then retry.',
  self_change: 'Use "Change password" in the top bar to change your own password.',
  email_exists: 'Sign in as that user, or reset its password from this list.',
};

const errorBox = document.getElementById('au-error');
const successBox = document.getElementById('au-success');
const form = document.getElementById('au-form');
const submitButton = document.getElementById('au-submit');
const refreshButton = document.getElementById('au-refresh');
const rows = document.getElementById('au-users');
const emptyBox = document.getElementById('au-empty');
const resetDialog = document.getElementById('au-reset-dialog');
const resetForm = document.getElementById('au-reset-form');
const resetTarget = document.getElementById('au-reset-target');
const resetInput = document.getElementById('au-reset-password');
const resetErrorBox = document.getElementById('au-reset-error');
const resetSubmit = document.getElementById('au-reset-submit');

let currentUserId = null;
let users = [];
let resetUserId = null;

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

function showResetError(message) {
  resetErrorBox.textContent = message;
  resetErrorBox.hidden = false;
}

// Server message first, then the optional hint. A hint the message already
// states (the self-reset answer points at "Change password") is not repeated.
function describe(result, hint) {
  const body = result.body ?? {};
  const message = body.message ?? `The server answered ${result.status}.`;
  if (hint && !message.includes(hint)) return `${message} ${hint}`;
  return message;
}

// One place that talks to the API. 204 has no body; a session that is gone
// sends the user to the login screen ONLY for "unauthenticated" (T7 rule),
// never for any other 401.
async function api(method, path, payload) {
  const init = { method };
  if (payload !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(payload);
  }
  const response = await fetch(path, init);
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status === 401 && body?.error === 'unauthenticated') {
    window.location.href = '/login.html';
    return { aborted: true };
  }
  return { ok: response.ok, status: response.status, body };
}

function hintFor(result) {
  const code = result.body?.error;
  return code ? ERROR_HINTS[code] : null;
}

function formatDate(value) {
  if (!value) return 'Never';
  const raw = String(value);
  // The API stores UTC (design §4): only append "Z" when there is no zone.
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

function cellText(value, className) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = value;
  return element;
}

function buildRow(user) {
  const row = document.createElement('tr');
  row.dataset.id = user.id;
  const isSelf = user.id === currentUserId;

  const identity = document.createElement('td');
  identity.append(cellText(user.email, 'admin-user__email'), cellText(user.fullName, 'admin-user__name'));

  const roleCell = document.createElement('td');
  const roleRow = document.createElement('div');
  roleRow.className = 'admin-row';
  const roleSelect = document.createElement('select');
  roleSelect.setAttribute('aria-label', `Role for ${user.email}`);
  for (const role of ROLES) {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = role;
    option.selected = role === user.role;
    roleSelect.append(option);
  }
  const saveRole = actionButton('Save', 'role');
  if (isSelf) {
    roleRow.title = 'Admins cannot change their own account.';
    saveRole.title = 'Admins cannot change their own account.';
  }
  roleRow.append(roleSelect, saveRole);
  roleCell.append(roleRow);

  const statusCell = document.createElement('td');
  const statusRow = document.createElement('div');
  statusRow.className = 'admin-row';
  const badge = document.createElement('span');
  badge.className = `admin-badge ${user.isActive ? 'admin-badge--on' : 'admin-badge--off'}`;
  badge.textContent = user.isActive ? 'Active' : 'Inactive';
  const toggle = user.isActive
    ? actionButton('Deactivate', 'toggle', 'ctrl-btn--stop')
    : actionButton('Activate', 'toggle', 'ctrl-btn--link');
  if (isSelf) toggle.title = 'Admins cannot change their own account.';
  statusRow.append(badge, toggle);
  statusCell.append(statusRow);

  const lastCell = document.createElement('td');
  lastCell.textContent = formatDate(user.lastLoginAt);

  const passwordCell = document.createElement('td');
  const reset = actionButton('Reset password', 'reset', 'ctrl-btn--reset');
  if (isSelf) reset.title = 'Use "Change password" for your own account.';
  passwordCell.append(reset);

  row.append(identity, roleCell, statusCell, lastCell, passwordCell);
  return row;
}

function render() {
  rows.replaceChildren(...users.map(buildRow));
  emptyBox.hidden = users.length > 0;
}

async function loadUsers() {
  const result = await api('GET', API);
  if (result.aborted) return;
  if (!result.ok) {
    showError(describe(result, hintFor(result)));
    return;
  }
  users = result.body?.users ?? [];
  render();
}

async function patchUser(user, changes) {
  clearFeedback();
  const result = await api('PATCH', `${API}/${user.id}`, changes);
  if (result.aborted) return;
  if (!result.ok) {
    showError(describe(result, hintFor(result)));
    return;
  }
  showSuccess(`${user.email} updated.`);
  await loadUsers();
}

rows.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const row = button.closest('tr');
  const user = users.find((entry) => entry.id === row?.dataset.id);
  if (!user) return;

  if (button.dataset.action === 'role') {
    const role = row.querySelector('select')?.value;
    if (!role || role === user.role) return;
    await patchUser(user, { role });
    return;
  }
  if (button.dataset.action === 'toggle') {
    await patchUser(user, { isActive: !user.isActive });
    return;
  }
  if (button.dataset.action === 'reset') openResetDialog(user);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearFeedback();

  const email = document.getElementById('au-email').value.trim();
  const fullName = document.getElementById('au-full-name').value.trim();
  const role = document.getElementById('au-role').value;
  // Passwords are never trimmed (§5.1).
  const temporaryPassword = document.getElementById('au-temp-password').value;

  if (!email || !email.includes('@')) {
    showError('Enter a valid email address.');
    return;
  }
  if (!fullName) {
    showError('Enter the full name.');
    return;
  }
  if (temporaryPassword.length < MIN_LENGTH || temporaryPassword.length > MAX_LENGTH) {
    showError(`The temporary password must be ${MIN_LENGTH} to ${MAX_LENGTH} characters long.`);
    return;
  }

  submitButton.disabled = true;
  try {
    const result = await api('POST', API, { email, fullName, role, temporaryPassword });
    if (result.aborted) return;
    if (!result.ok) {
      showError(describe(result, hintFor(result)));
      return;
    }
    form.reset();
    showSuccess(
      `User ${email} created. Give them the temporary password out of band: it must be changed at first sign-in.`
    );
    await loadUsers();
  } finally {
    submitButton.disabled = false;
  }
});

function openResetDialog(user) {
  resetUserId = user.id;
  resetTarget.textContent = `Setting a temporary password for ${user.email}.`;
  resetInput.value = '';
  resetErrorBox.textContent = '';
  resetErrorBox.hidden = true;
  if (typeof resetDialog.showModal === 'function') resetDialog.showModal();
  else resetDialog.setAttribute('open', '');
}

function closeResetDialog() {
  resetUserId = null;
  if (typeof resetDialog.close === 'function') resetDialog.close();
  else resetDialog.removeAttribute('open');
}

document.getElementById('au-reset-close').addEventListener('click', closeResetDialog);
// Escape (and any other way the dialog closes) must drop the pending target.
resetDialog.addEventListener('close', () => {
  resetUserId = null;
});

resetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  resetErrorBox.hidden = true;
  if (!resetUserId) return;

  // Passwords are never trimmed (§5.1).
  const temporaryPassword = resetInput.value;
  if (temporaryPassword.length < MIN_LENGTH || temporaryPassword.length > MAX_LENGTH) {
    showResetError(`The temporary password must be ${MIN_LENGTH} to ${MAX_LENGTH} characters long.`);
    return;
  }

  resetSubmit.disabled = true;
  try {
    const result = await api('POST', `${API}/${resetUserId}/reset-password`, { temporaryPassword });
    if (result.aborted) return;
    if (!result.ok) {
      // The server already says what to do (409 self_change points at
      // "Change password"), so no hint is appended here.
      showResetError(describe(result));
      return;
    }
    const email = users.find((entry) => entry.id === resetUserId)?.email ?? 'that user';
    closeResetDialog();
    showSuccess(
      `Password reset for ${email}. They must change it at first sign-in and every session of theirs was signed out.`
    );
    await loadUsers();
  } finally {
    resetSubmit.disabled = false;
  }
});

refreshButton.addEventListener('click', () => {
  clearFeedback();
  loadUsers();
});

// Who am I (for the self-changes the API refuses) and then the list.
(async function init() {
  const me = await api('GET', '/api/auth/me');
  if (me.aborted) return;
  if (me.ok) currentUserId = me.body?.user?.id ?? null;
  await loadUsers();
})();
