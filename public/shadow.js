// QA Shadow screen (PLAN F5 / SPEC step 6): the pending queue with its
// Task ID search (D14), the review form and the Shadow's own history.
//
// The server owns every rule (D5, D10, D14, D21, D24, D26): this file only
// renders what it answers and shows the message the API returns — the 409
// of a QA somebody else took or that is already closed, the 403 of one that
// is not yours, the 400 of an incomplete checklist. Every string that
// reaches the DOM goes through textContent: notes, summaries and server
// messages are user data and are never parsed as HTML.
//
// The queue carries no checklist (F6 adds the owner's view), so reloading
// while a review is open starts the form empty again: the marks saved with
// "Guardar avance" stay on the server, only the form loses them.
const API = '/api/qa-records';

// The BUGS.md criteria (D7), copied from src/services/qaBugCatalog.js.
// This copy only LABELS the checklist and previews the generated status
// and comment (D8): the server recomputes both from its own catalog when
// it closes the QA, so a stale copy here can never change the result.
const QA_BUGS = Object.freeze({
  'OPP-01': { name: 'Margins and paddings', type: 'Styling', severity: 'Opportunity' },
  'OPP-02': { name: 'Visual styling (colors, gradients, CTAs, links, content)', type: 'Styling', severity: 'Opportunity' },
  'FAIL-01': { name: 'Cropped images', type: 'Styling', severity: 'Failed' },
  'FAIL-02': { name: 'Image attributes: src', type: 'Images', severity: 'Failed' },
  'FAIL-03': { name: 'Image attributes: title', type: 'Images', severity: 'Failed' },
  'FAIL-04': { name: 'Image attributes: alt', type: 'Images', severity: 'Failed' },
  'FAIL-05': { name: 'Relative link', type: 'Links', severity: 'Failed' },
  'FAIL-06': { name: 'Broken links', type: 'Links', severity: 'Failed' },
  'FAIL-07': { name: 'Links not verified', type: 'Links', severity: 'Failed' },
  'FAIL-08': { name: 'Anchors not configured in Composer', type: 'Anchors', severity: 'Failed' },
  'FAIL-09': { name: 'Relative path with anchor', type: 'Anchors', severity: 'Failed' },
  'FAIL-10': { name: 'Double H1 tags', type: 'H1', severity: 'Failed' },
  'FAIL-11': { name: 'Incorrect H1 page title', type: 'H1', severity: 'Failed' },
  'FAIL-12': { name: 'Inventory: wrong number of vehicles', type: 'Inventory', severity: 'Failed' },
  'FAIL-13': { name: 'Inventory: wrong vehicle inventory', type: 'Inventory', severity: 'Failed' },
  'FAIL-14': { name: 'Inventory: wrong inventory style', type: 'Inventory', severity: 'Failed' },
  'FAIL-15': { name: 'Sitemap XML/HTML not enabled', type: 'SEO', severity: 'Failed' },
  'FAIL-16': { name: 'Lead source: incorrect Source field in forms', type: 'Forms', severity: 'Failed' },
  'FAIL-17': { name: 'FAQ Schema', type: 'SEO', severity: 'Failed' },
  'CRIT-01': { name: 'Missing copy', type: 'Copy', severity: 'Critical' },
  'CRIT-02': { name: 'Wrong copy', type: 'Copy', severity: 'Critical' },
  'CRIT-03': { name: 'Instructions not followed', type: 'Instructions', severity: 'Critical' },
});

// The manual checklist (D19): the bugs the tool does NOT check, in the
// order of the F0 table.
const MANUAL_ITEMS = [
  'OPP-01', 'OPP-02', 'FAIL-01', 'FAIL-11', 'FAIL-12', 'FAIL-13',
  'FAIL-14', 'FAIL-15', 'FAIL-16', 'FAIL-17', 'CRIT-02', 'CRIT-03',
];

const CHECK_STATES = [
  { value: 'passed', label: 'Passed' },
  { value: 'bug', label: 'Bug' },
  { value: 'n/a', label: 'N/A' },
];
const BUG_DEVICES = ['M', 'D', 'M/D'];
const SEVERITIES = ['Critical', 'Failed', 'Opportunity'];
const DESCRIPTION_MAX = 200; // same cap as the summary texts (D3)

const errorBox = document.getElementById('sh-error');
const successBox = document.getElementById('sh-success');

const pendingRows = document.getElementById('sh-pending-rows');
const pendingEmpty = document.getElementById('sh-pending-empty');
const pendingSearch = document.getElementById('sh-pending-search');
const pendingSearchButton = document.getElementById('sh-pending-search-btn');
const pendingClearButton = document.getElementById('sh-pending-clear-btn');
const pendingRefreshButton = document.getElementById('sh-pending-refresh');

const reviewSection = document.getElementById('sh-review');
const reviewTitle = document.getElementById('sh-review-title');
const reviewBack = document.getElementById('sh-review-back');
const reviewUrl = document.getElementById('sh-review-url');
const reviewOwner = document.getElementById('sh-review-owner');
const reviewClosed = document.getElementById('sh-review-closed');
const reviewNote = document.getElementById('sh-review-note');
const reviewSummary = document.getElementById('sh-review-summary');
const reviewChecklist = document.getElementById('sh-review-checklist');
const statusInput = document.getElementById('sh-status');
const commentInput = document.getElementById('sh-comment');
const saveButton = document.getElementById('sh-save');
const closeButton = document.getElementById('sh-close');

const historyRows = document.getElementById('sh-history-rows');
const historyEmpty = document.getElementById('sh-history-empty');
const historySearch = document.getElementById('sh-history-search');
const historySearchButton = document.getElementById('sh-history-search-btn');
const historyClearButton = document.getElementById('sh-history-clear-btn');
const historyRefreshButton = document.getElementById('sh-history-refresh');

let pending = [];
let history = [];
let pendingQuery = '';
let historyQuery = '';
// The record on screen and how: "edit" (a QA this Shadow took, D10) or
// "view" (a closed one from the history, read-only).
let current = null;
let mode = 'edit';
// D8: only the fields the Shadow actually typed are sent; the others stay
// with the generated value the server computes from its own catalog.
let statusDirty = false;
let commentDirty = false;

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

// One request to the API: the 401 of an expired session sends the Shadow
// to the login page, every other answer comes back with its body so the
// caller can show the message the server wrote.
async function api(method, path, payload) {
  const response = await fetch(path, {
    method,
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401 && body?.error === 'unauthenticated') {
    redirectToLogin();
    return null;
  }
  return { status: response.status, ok: response.ok, body };
}

function fail(result) {
  showError(result.body?.message ?? `The server answered ${result.status}.`);
}

// The API stores UTC (design §4): only append "Z" when there is no zone.
function formatDate(value) {
  if (!value) return '—';
  const raw = String(value);
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOrDash(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function linkCell(pageUrl) {
  const cell = document.createElement('td');
  cell.append(QaView.pageLink(pageUrl));
  return cell;
}

function actionButton(label, action, variant = 'ctrl-btn--link') {
  const button = document.createElement('button');
  button.type = 'button';
  // .ctrl-btn alone has no background and white text: always pair it with
  // a colour modifier from styles.css.
  button.className = `ctrl-btn ${variant}`;
  button.dataset.action = action;
  button.textContent = label;
  return button;
}

// ── The tool summary, with the N/A mark of a finding (D26/D27) ─────────

function explanationParagraph(value) {
  if (value === null || value === undefined || value === '') return null;
  const paragraph = document.createElement('p');
  paragraph.className = 'admin-note';
  paragraph.textContent = `N/A: ${value}`;
  return paragraph;
}

// One finding of a check. The N/A control only exists for a finding that
// would otherwise count (D26): one with no BUGS.md id never reaches the
// status, so it can never be N/A either — the server refuses that with a
// 400.
function buildFinding(checkName, item, index, { editable, na }) {
  const key = `${checkName}#${index}`;
  const entry = document.createElement('li');
  entry.dataset.naKey = key;

  entry.append(QaView.findingContent(item));

  const countable = isPlainObject(item) && Boolean(QA_BUGS[item.bugId]);
  const marked = Boolean(na && Object.hasOwn(na, key));

  const badge = document.createElement('span');
  badge.className = 'admin-badge admin-badge--closed';
  badge.textContent = 'N/A';
  badge.dataset.naBadge = '';
  badge.hidden = !marked;
  entry.append(badge);

  if (editable && countable) {
    entry.dataset.na = marked ? 'true' : 'false';

    const button = actionButton(marked ? 'Undo N/A' : 'Mark N/A', 'na');
    entry.append(button);

    // The explanation is optional (D27): "si quiere puede explicar, no
    // quiero hacerlo muy pesado".
    const row = document.createElement('div');
    row.className = 'admin-row';
    row.dataset.naExplanation = '';
    row.hidden = !marked;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 200;
    input.placeholder = 'Why is this N/A? (optional)';
    input.setAttribute('aria-label', `Why is ${key} N/A? (optional)`);
    if (marked && na[key]) input.value = String(na[key]);
    row.append(input);
    entry.append(row);
    return entry;
  }

  const explanation = explanationParagraph(marked ? na[key] : null);
  if (explanation) entry.append(explanation);
  return entry;
}

function buildSection(name, check, options) {
  const section = document.createElement('section');
  section.className = 'myqa-section';

  section.append(QaView.sectionHeading(name, check));

  if (check?.result) {
    const result = document.createElement('p');
    result.className = 'myqa-section__result';
    result.textContent = String(check.result);
    section.append(result);
  }

  const items = Array.isArray(check?.items) ? check.items : [];
  if (items.length > 0) {
    const list = document.createElement('ul');
    list.className = 'myqa-findings';
    items.forEach((item, index) => list.append(buildFinding(name, item, index, options)));
    section.append(list);
  }
  return section;
}

// The summary of the record on screen: editable while reviewing, read-only
// for a closed QA (where the stored N/A marks are shown as they were saved).
function renderSummary(record, { editable, na = null }) {
  const checks = record?.summary?.checks;
  if (!isPlainObject(checks)) {
    reviewSummary.replaceChildren(textParagraph('admin-empty', 'This QA has no saved summary.'));
    return;
  }
  // Failed sections first: that is where the Shadow has work to do. The
  // N/A keys stay `<check>#<index>`, so the order changes nothing the
  // server sees.
  const entries = Object.entries(checks).sort(
    ([nameA, a], [nameB, b]) => QaView.statusRank(nameA, a) - QaView.statusRank(nameB, b)
  );
  const grid = document.createElement('div');
  grid.className = 'qa-sections';
  grid.append(...entries.map(([name, check]) => buildSection(name, check, { editable, na })));
  reviewSummary.replaceChildren(QaView.overview(checks), grid);
}

function textParagraph(className, text) {
  const paragraph = document.createElement('p');
  paragraph.className = className;
  paragraph.textContent = text;
  return paragraph;
}

// ── The manual checklist (D15/D19/D21/D24) ─────────────────────────────

function selectedState(itemId) {
  return reviewChecklist.querySelector(`input[name="sh-${itemId}"]:checked`)?.value ?? null;
}

function deviceValue(itemId) {
  return reviewChecklist.querySelector(`input[name="sh-dev-${itemId}"]:checked`)?.value ?? '';
}

// One segmented control: radios styled as joined buttons (.qa-seg).
function segmented(name, options, selected, label) {
  const group = document.createElement('div');
  group.className = 'qa-seg';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const wrap = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = selected === option.value;
    const text = document.createElement('span');
    text.textContent = option.label;
    wrap.append(input, text);
    group.append(wrap);
  }
  return group;
}

function buildChecklistRow(itemId, state, { editable, device: savedDevice = '' }) {
  const row = document.createElement('tr');

  const item = document.createElement('td');
  const id = document.createElement('span');
  id.className = 'myqa-task-id';
  id.textContent = itemId;
  const name = document.createElement('span');
  name.textContent = ` ${QA_BUGS[itemId]?.name ?? ''}`;
  item.append(id, name);

  const result = document.createElement('td');
  result.className = 'qa-nowrap';
  const device = document.createElement('td');
  device.className = 'qa-nowrap';

  if (!editable) {
    // Read-only (a closed QA): the state as a badge. The device of a
    // manual bug lives in its comment line (D20), not in this shape.
    const option = CHECK_STATES.find((entry) => entry.value === state);
    if (option) {
      const badge = document.createElement('span');
      const badgeClass =
        option.value === 'passed' ? 'admin-badge--on'
          : option.value === 'bug' ? 'admin-badge--off'
            : 'admin-badge--closed';
      badge.className = `admin-badge ${badgeClass}`;
      badge.textContent = option.label;
      result.append(badge);
    } else {
      result.textContent = '—';
    }
    device.textContent = '—';
    row.append(item, result, device);
    return row;
  }

  result.append(segmented(`sh-${itemId}`, CHECK_STATES, state, `Result for ${itemId}`));

  // D21: the device only matters for a Bug, so its choice appears with the
  // "Bug" button and a short hint stands in for it otherwise.
  const devices = segmented(
    `sh-dev-${itemId}`,
    BUG_DEVICES.map((value) => ({ value, label: value })),
    state === 'bug' ? savedDevice : '',
    `Device for ${itemId}`
  );
  devices.classList.add('qa-seg--device');
  devices.dataset.device = itemId;
  devices.hidden = state !== 'bug';
  const hint = document.createElement('span');
  hint.className = 'qa-device-hint';
  hint.dataset.deviceHint = itemId;
  hint.textContent = '—';
  hint.hidden = state === 'bug';
  device.append(devices, hint);

  row.append(item, result, device);
  return row;
}

function renderChecklist(record, { editable }) {
  const stored = isPlainObject(record?.checklist) ? record.checklist : {};
  const devices = isPlainObject(record?.bugDevices) ? record.bugDevices : {};
  reviewChecklist.replaceChildren(
    ...MANUAL_ITEMS.map((itemId) =>
      buildChecklistRow(itemId, stored[itemId], { editable, device: devices[itemId] ?? '' })
    )
  );
}

// ── The status and comment the server will generate (D8 preview) ───────
// Shown before closing so the Shadow knows what they are confirming. The
// server recomputes both from its own catalog: a field the Shadow edited
// is sent, a field they left alone is not (D7/D20/D21).

function isMarkedNa(key) {
  for (const entry of reviewSummary.querySelectorAll('li[data-na-key]')) {
    if (entry.dataset.naKey === key) return entry.dataset.na === 'true';
  }
  return false;
}

// The same bugs the server builds at closure: the tool's findings of the
// saved summary (minus the ones marked N/A) and then the manual items
// marked as Bug, in F0 order.
function currentBugs() {
  const bugs = [];
  for (const [checkName, check] of Object.entries(current?.summary?.checks ?? {})) {
    const items = Array.isArray(check?.items) ? check.items : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!isPlainObject(item)) continue;
      const info = QA_BUGS[item.bugId];
      if (!info) continue;
      if (isMarkedNa(`${checkName}#${index}`)) continue;
      bugs.push({
        device: BUG_DEVICES.includes(item.device) ? item.device : 'D',
        type: info.type,
        severity: info.severity,
        description: String(item.text ?? info.name).slice(0, DESCRIPTION_MAX),
      });
    }
  }
  for (const itemId of MANUAL_ITEMS) {
    if (selectedState(itemId) !== 'bug') continue;
    const info = QA_BUGS[itemId];
    bugs.push({
      device: deviceValue(itemId) || '—',
      type: info.type,
      severity: info.severity,
      description: info.name,
    });
  }
  return bugs;
}

function previewFromBugs(bugs) {
  if (bugs.length === 0) return { status: 'Passed', comment: null };
  const counts = { Critical: 0, Failed: 0, Opportunity: 0 };
  for (const bug of bugs) counts[bug.severity] += 1;
  const status =
    bugs.length === 1
      ? bugs[0].severity
      : SEVERITIES.filter((severity) => counts[severity] > 0)
          .map((severity) => `${severity} (${counts[severity]})`)
          .join(', ');
  const comment = bugs
    .map((bug) => `${bug.device} / ${bug.type} / ${bug.severity} / ${bug.description}`)
    .join('\n');
  return { status, comment };
}

// The preview fills the fields the Shadow has NOT typed yet, so their own
// edits are never overwritten while they work.
function recomputePreview() {
  if (mode !== 'edit' || !current) return;
  const preview = previewFromBugs(currentBugs());
  if (!statusDirty) statusInput.value = preview.status;
  if (!commentDirty) commentInput.value = preview.comment ?? '';
}

// ── What the screen sends ──────────────────────────────────────────────

// The payload is the WHOLE state of the form: what is not sent is what the
// server generates (D7/D8), and a field left out never keeps a value the
// form no longer shows.
function buildPayload() {
  const checklist = {};
  const bugDevices = {};
  for (const itemId of MANUAL_ITEMS) {
    const state = selectedState(itemId);
    if (!state) continue;
    checklist[itemId] = state;
    if (state === 'bug') {
      const device = deviceValue(itemId);
      if (device) bugDevices[itemId] = device;
    }
  }
  const payload = { checklist };
  if (Object.keys(bugDevices).length > 0) payload.bugDevices = bugDevices;

  const naFindings = {};
  for (const entry of reviewSummary.querySelectorAll('li[data-na-key]')) {
    if (entry.dataset.na !== 'true') continue;
    const input = entry.querySelector('input[type="text"]');
    naFindings[entry.dataset.naKey] = input ? input.value.trim() : '';
  }
  if (Object.keys(naFindings).length > 0) payload.naFindings = naFindings;

  if (statusDirty) payload.qaStatus = statusInput.value;
  if (commentDirty) payload.qaComment = commentInput.value;
  return payload;
}

function setBusy(busy) {
  saveButton.disabled = busy;
  closeButton.disabled = busy;
}

// ── Opening a record ───────────────────────────────────────────────────

function showRecordHead(record) {
  reviewTitle.textContent = `${mode === 'edit' ? 'Reviewing' : 'Closed QA'} ${record.taskId}`;
  reviewUrl.replaceChildren(QaView.pageLink(record.pageUrl, { compact: false }));
  reviewOwner.textContent = record.ownerFullName ? `Owner: ${record.ownerFullName}` : 'Owner: —';
  reviewNote.textContent = record.note
    ? String(record.note)
    : 'No note was left for the QA Shadow.';
}

// "Tomar" / "Revisar" (D10): a QA this Shadow already holds opens without
// another request; a pending one is taken first, and the server decides
// who wins the race (409 for the loser).
async function takeOrReview(record) {
  clearFeedback();
  if (record.reviewerId) {
    openReview(record);
    return;
  }
  const result = await api('POST', `${API}/${record.id}/take`, {});
  if (!result) return;
  if (!result.ok) {
    fail(result);
    return;
  }
  const taken = result.body?.record ?? record;
  // The queue already showed this row as pending: mark it as ours before
  // the form opens, so the row stops offering "Tomar" (D10).
  const index = pending.findIndex((entry) => entry.id === taken.id);
  if (index !== -1) {
    pending[index] = { ...pending[index], reviewerId: taken.reviewerId };
    renderPending();
  }
  openReview(taken);
}

function openReview(record) {
  current = record;
  mode = 'edit';
  statusDirty = false;
  commentDirty = false;

  reviewSection.hidden = false;
  reviewBack.textContent = 'Back to the queue';
  reviewClosed.hidden = true;
  showRecordHead(record);
  // The queue hands back this Shadow's saved draft (checklist, N/A marks,
  // devices, status/comment), so "Guardar avance" survives a reload.
  const stored = isPlainObject(record.checklist) ? record.checklist : {};
  renderSummary(record, { editable: true, na: isPlainObject(stored._na) ? stored._na : null });
  renderChecklist(record, { editable: true });
  statusInput.disabled = false;
  commentInput.disabled = false;
  // A saved status/comment draft was an edit of the Shadow (D8): keep it
  // instead of letting the preview overwrite it.
  statusDirty = typeof record.qaStatus === 'string' && record.qaStatus !== '';
  commentDirty = typeof record.qaComment === 'string';
  statusInput.value = statusDirty ? record.qaStatus : '';
  commentInput.value = commentDirty ? record.qaComment : '';
  saveButton.hidden = false;
  closeButton.hidden = false;
  recomputePreview();
  reviewSection.scrollIntoView({ block: 'start' });
}

// A closed QA from the history, read-only: the stored status, comment,
// checklist and N/A marks, with nothing to send.
function openClosed(record) {
  current = record;
  mode = 'view';
  statusDirty = false;
  commentDirty = false;

  reviewSection.hidden = false;
  reviewBack.textContent = 'Back to the history';
  reviewClosed.hidden = false;
  reviewClosed.textContent =
    `Closed ${formatDate(record.closedAt)} · ` +
    `Critical ${record.criticalCount ?? 0} · Failed ${record.failedCount ?? 0} · ` +
    `Opportunity ${record.opportunityCount ?? 0}`;
  showRecordHead(record);
  const stored = isPlainObject(record.checklist) ? record.checklist : {};
  renderSummary(record, { editable: false, na: isPlainObject(stored._na) ? stored._na : null });
  renderChecklist(record, { editable: false });
  statusInput.disabled = true;
  commentInput.disabled = true;
  statusInput.value = record.qaStatus ?? '';
  commentInput.value = record.qaComment ?? '';
  saveButton.hidden = true;
  closeButton.hidden = true;
  reviewSection.scrollIntoView({ block: 'start' });
}

// ── The two actions of the form ────────────────────────────────────────

async function saveProgress() {
  if (!current || mode !== 'edit') return;
  clearFeedback();
  const payload = buildPayload();
  setBusy(true);
  try {
    const result = await api('PATCH', `${API}/${current.id}/review`, payload);
    if (!result) return;
    if (!result.ok) {
      fail(result);
      return;
    }
    showSuccess('Progress saved. The QA stays open and yours.');
    // Refresh the queue so reopening this QA shows the draft just saved.
    await loadPending();
  } finally {
    setBusy(false);
  }
}

async function closeQa() {
  if (!current || mode !== 'edit') return;
  clearFeedback();
  const payload = buildPayload();
  setBusy(true);
  try {
    const result = await api('POST', `${API}/${current.id}/close`, payload);
    if (!result) return;
    if (!result.ok) {
      fail(result);
      return;
    }
    const closed = result.body?.record;
    showSuccess(
      `QA ${closed?.taskId ?? current.taskId} closed with status ${closed?.qaStatus ?? ''}.`
    );
    reviewSection.hidden = true;
    current = null;
    await Promise.all([loadPending(), loadHistory()]);
  } finally {
    setBusy(false);
  }
}

// ── The two lists ──────────────────────────────────────────────────────

function buildPendingRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record.id;

  const taskId = document.createElement('td');
  taskId.className = 'qa-nowrap';
  const value = document.createElement('span');
  value.className = 'myqa-task-id';
  value.textContent = record.taskId;
  taskId.append(value);

  const owner = document.createElement('td');
  owner.textContent = fieldOrDash(record.ownerFullName);

  const saved = document.createElement('td');
  saved.className = 'qa-nowrap';
  saved.textContent = formatDate(record.createdAt);

  // The queue only holds other people's open QAs and the ones this Shadow
  // took (D5/D10): a QA this Shadow already took says "Revisar" instead of "Tomar".
  const action = document.createElement('td');
  action.className = 'qa-nowrap';
  const actions = document.createElement('div');
  actions.className = 'qa-actions';
  action.append(actions);
  actions.append(actionButton(record.reviewerId ? 'Revisar' : 'Tomar', 'take'));

  row.append(taskId, linkCell(record.pageUrl), owner, saved, action);
  return row;
}

function renderPending() {
  pendingRows.replaceChildren(...pending.map(buildPendingRow));
  pendingEmpty.textContent = pendingQuery
    ? 'No pending QA with that Task ID.'
    : 'No pending QA right now.';
  pendingEmpty.hidden = pending.length > 0;
}

function buildHistoryRow(record) {
  const row = document.createElement('tr');
  row.dataset.id = record.id;

  const taskId = document.createElement('td');
  taskId.className = 'qa-nowrap';
  const value = document.createElement('span');
  value.className = 'myqa-task-id';
  value.textContent = record.taskId;
  taskId.append(value);

  const owner = document.createElement('td');
  owner.textContent = fieldOrDash(record.ownerFullName);

  const closed = document.createElement('td');
  closed.className = 'qa-nowrap';
  closed.textContent = formatDate(record.closedAt);

  const status = document.createElement('td');
  status.textContent = fieldOrDash(record.qaStatus);

  const action = document.createElement('td');
  action.className = 'qa-nowrap';
  const actions = document.createElement('div');
  actions.className = 'qa-actions';
  action.append(actions);
  actions.append(actionButton('Ver', 'view'));

  row.append(taskId, owner, closed, status, action);
  return row;
}

function renderHistory() {
  historyRows.replaceChildren(...history.map(buildHistoryRow));
  historyEmpty.textContent = historyQuery
    ? 'No closed QA with that Task ID.'
    : 'The QAs you close will appear here.';
  historyEmpty.hidden = history.length > 0;
}

async function loadPending(taskId = pendingQuery) {
  const query = String(taskId ?? '').trim();
  const suffix = query ? `?taskId=${encodeURIComponent(query)}` : '';
  const result = await api('GET', `${API}${suffix}`);
  if (!result) return;
  if (!result.ok) {
    fail(result);
    return;
  }
  pendingQuery = query;
  pending = result.body?.records ?? [];
  renderPending();
}

async function loadHistory(taskId = historyQuery) {
  const query = String(taskId ?? '').trim();
  const suffix = query ? `?taskId=${encodeURIComponent(query)}` : '';
  const result = await api('GET', `${API}/history${suffix}`);
  if (!result) return;
  if (!result.ok) {
    fail(result);
    return;
  }
  historyQuery = query;
  history = result.body?.records ?? [];
  renderHistory();
}

// ── Events ─────────────────────────────────────────────────────────────

pendingRows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="take"]');
  if (!button) return;
  const row = button.closest('tr');
  const record = pending.find((entry) => entry.id === row?.dataset.id);
  if (record) takeOrReview(record);
});

historyRows.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="view"]');
  if (!button) return;
  const row = button.closest('tr');
  const record = history.find((entry) => entry.id === row?.dataset.id);
  if (record) openClosed(record);
});

// D26: one button per finding turns it into an N/A (and back), revealing
// the optional explanation (D27).
reviewSummary.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="na"]');
  if (!button || mode !== 'edit') return;
  const entry = button.closest('li[data-na-key]');
  if (!entry) return;

  const marked = entry.dataset.na === 'true';
  entry.dataset.na = marked ? 'false' : 'true';
  button.textContent = marked ? 'Mark N/A' : 'Undo N/A';
  const badge = entry.querySelector('[data-na-badge]');
  if (badge) badge.hidden = marked;
  const explanation = entry.querySelector('[data-na-explanation]');
  if (explanation) explanation.hidden = marked;
  if (!marked) entry.querySelector('input[type="text"]')?.focus();
  recomputePreview();
});

reviewChecklist.addEventListener('change', (event) => {
  const target = event.target;
  if (!target.matches('input[type="radio"]')) return;
  if (!target.name.startsWith('sh-dev-')) {
    // A result changed: show the device choice only for a Bug (D21) and
    // forget the device when the item stops being one.
    const row = target.closest('tr');
    const devices = row?.querySelector('[data-device]');
    const hint = row?.querySelector('[data-device-hint]');
    const isBug = target.value === 'bug';
    if (devices) {
      devices.hidden = !isBug;
      if (!isBug) devices.querySelectorAll('input').forEach((input) => { input.checked = false; });
    }
    if (hint) hint.hidden = isBug;
  }
  recomputePreview();
});

statusInput.addEventListener('input', () => {
  statusDirty = true;
});
commentInput.addEventListener('input', () => {
  commentDirty = true;
});

saveButton.addEventListener('click', saveProgress);
closeButton.addEventListener('click', closeQa);
reviewBack.addEventListener('click', () => {
  reviewSection.hidden = true;
  current = null;
  clearFeedback();
});

pendingSearchButton.addEventListener('click', () => {
  clearFeedback();
  loadPending(pendingSearch.value);
});
pendingClearButton.addEventListener('click', () => {
  clearFeedback();
  pendingSearch.value = '';
  loadPending('');
});
pendingRefreshButton.addEventListener('click', () => {
  clearFeedback();
  loadPending(pendingSearch.value);
});
pendingSearch.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  clearFeedback();
  loadPending(pendingSearch.value);
});

historySearchButton.addEventListener('click', () => {
  clearFeedback();
  loadHistory(historySearch.value);
});
historyClearButton.addEventListener('click', () => {
  clearFeedback();
  historySearch.value = '';
  loadHistory('');
});
historyRefreshButton.addEventListener('click', () => {
  clearFeedback();
  loadHistory(historySearch.value);
});
historySearch.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  clearFeedback();
  loadHistory(historySearch.value);
});

loadPending();
loadHistory();
