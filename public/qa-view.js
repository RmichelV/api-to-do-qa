// Shared rendering of a saved QA summary (PLAN F3 D33 "Mis QA" and F5
// "QA Shadow"). Both screens show the same sections and findings, so the
// labels and the finding layout live here once. Classic script (no build
// step): it exposes window.QaView and must load before the page script.
//
// Every value reaches the DOM through textContent: saved summaries are
// user data and are never parsed as HTML.
(function () {
  // Readable names for the summary keys the tool saves (F2).
  const CHECK_LABELS = {
    h1: 'H1',
    linkStatus: 'Link status',
    linksAdded: 'Requested links',
    textDesktop: 'Copy · Desktop',
    textMobile: 'Copy · Mobile',
    images: 'Images',
    anchors: 'Anchors',
  };

  const STATUS_LABELS = { pass: 'Passed', warn: 'Warning', fail: 'Failed', not_run: 'Not run' };

  // Failed first, then warnings: the order a reader looks for problems in.
  const STATUS_ORDER = { fail: 0, warn: 1, pass: 2, not_run: 3 };

  // QAs saved before `warn` existed stored the tool's orange H1 results as
  // `fail`. These are the exact result lines the tool paints orange.
  const LEGACY_WARNINGS = {
    h1: ['No visible H1 found, only sr-only H1 is present', 'H1 and sr-only H1 are different'],
  };

  const SEVERITY_CLASS = {
    Critical: 'qa-chip--critical',
    Failed: 'qa-chip--failed',
    Opportunity: 'qa-chip--opportunity',
  };

  const DEVICE_LABELS = { M: 'Mobile', D: 'Desktop', 'M/D': 'Mobile + Desktop' };

  function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function hasValue(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function checkLabel(name) {
    return CHECK_LABELS[name] ?? String(name);
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] ?? (hasValue(status) ? String(status) : '—');
  }

  // The status to show for one check: `warn` for the orange results, even
  // when an older record saved them as `fail`.
  function statusOf(name, check) {
    const status = check?.status;
    if (status === 'fail' && LEGACY_WARNINGS[name]?.includes(check?.result)) return 'warn';
    return status;
  }

  function statusRank(name, check) {
    return STATUS_ORDER[statusOf(name, check)] ?? 4;
  }

  function statusBadgeClass(status) {
    if (status === 'pass') return 'admin-badge--on';
    if (status === 'warn') return 'admin-badge--warn';
    if (status === 'fail') return 'admin-badge--off';
    return 'admin-badge--closed';
  }

  function chip(text, modifier = '', title = '') {
    const element = document.createElement('span');
    element.className = `qa-chip ${modifier}`.trim();
    element.textContent = text;
    if (title) element.title = title;
    return element;
  }

  // One finding as chips (bug id, severity, device) plus its text. Fields
  // that are empty are simply left out instead of showing dashes.
  function findingContent(item) {
    const wrap = document.createElement('span');
    wrap.className = 'qa-finding';
    if (!isPlainObject(item)) {
      wrap.textContent = String(item);
      return wrap;
    }
    if (hasValue(item.bugId)) wrap.append(chip(String(item.bugId), 'qa-chip--id', item.type ?? ''));
    if (hasValue(item.severity)) {
      wrap.append(chip(String(item.severity), SEVERITY_CLASS[item.severity] ?? ''));
    }
    if (hasValue(item.device)) {
      wrap.append(chip(String(item.device), 'qa-chip--device', DEVICE_LABELS[item.device] ?? ''));
    }
    const text = document.createElement('span');
    text.className = 'qa-finding__text';
    if (hasValue(item.text)) {
      text.textContent = String(item.text);
    } else if (!hasValue(item.bugId)) {
      // Unknown shape: show its own pairs rather than nothing.
      text.textContent = Object.entries(item)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');
    }
    wrap.append(text);
    return wrap;
  }

  // Section header: readable name + status badge.
  function sectionHeading(name, check) {
    const status = statusOf(name, check);
    const heading = document.createElement('h4');
    const label = document.createElement('span');
    label.className = 'myqa-section__name';
    label.textContent = checkLabel(name);
    const badge = document.createElement('span');
    badge.className = `admin-badge ${statusBadgeClass(status)}`;
    badge.textContent = statusLabel(status);
    heading.append(label, badge);
    return heading;
  }

  // "2 failed · 3 passed · 2 not run" for the top of a summary.
  function overview(checks) {
    const counts = { fail: 0, warn: 0, pass: 0, not_run: 0 };
    for (const [name, check] of Object.entries(isPlainObject(checks) ? checks : {})) {
      const status = statusOf(name, check);
      if (Object.hasOwn(counts, status)) counts[status] += 1;
    }
    const line = document.createElement('p');
    line.className = 'qa-overview';
    line.append(
      chip(`${counts.fail} failed`, counts.fail > 0 ? 'qa-chip--failed' : ''),
      ...(counts.warn > 0 ? [chip(`${counts.warn} warning${counts.warn === 1 ? '' : 's'}`, 'qa-chip--warn')] : []),
      chip(`${counts.pass} passed`, 'qa-chip--passed'),
      chip(`${counts.not_run} not run`)
    );
    return line;
  }

  // A page URL as a link that fits one table cell: the visible text is cut
  // with an ellipsis by CSS and the full URL stays in the tooltip.
  function pageLink(url, { compact = true } = {}) {
    const value = String(url ?? '');
    if (!/^https?:\/\//i.test(value)) {
      const text = document.createElement('span');
      text.textContent = value || '—';
      return text;
    }
    const link = document.createElement('a');
    link.href = value;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    link.title = value;
    link.className = compact ? 'qa-url' : 'qa-url qa-url--full';
    link.textContent = value.replace(/^https?:\/\//i, '');
    return link;
  }

  window.QaView = {
    checkLabel,
    statusLabel,
    statusOf,
    statusRank,
    statusBadgeClass,
    findingContent,
    sectionHeading,
    overview,
    pageLink,
    isPlainObject,
  };
})();
