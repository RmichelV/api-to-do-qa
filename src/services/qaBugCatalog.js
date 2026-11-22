// The bug criteria of docs/features/qa-records/BUGS.md, on the server
// (PLAN F0/F5, D7). One table maps each bug id to its name, type and
// severity, and MANUAL_CHECKLIST is the list of items the tool does NOT
// check (D19) — the 12 rows of the F0 checklist.
//
// Closing a QA builds the comment (D20: "Device / Type / Severity /
// Description", one line per bug) and the final status (D21/D25) from
// here, so the server never depends on QA_BUG_INFO in public/index.html:
// that copy only labels findings while they are displayed (F2).
//
// Pure data and pure builders: no SQL, no request, no AppError. The
// service validates the payload and owns the HTTP contract.

// id → { name, type, severity }. `name` is the "Bug" column of BUGS.md and
// becomes the Description of a manual bug's comment line; `type` is the
// category of the Summary table (Styling, Images, Links, …).
export const QA_BUGS = Object.freeze({
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

// The manual checklist (D19): every bug the tool does not check, in the
// order of the F0 table. Closing requires all of them (D24), each one as
// passed / bug / n/a. FAIL-17 travels with the manual list because the
// Schema.org validator is not part of the tool (F0).
export const MANUAL_CHECKLIST = Object.freeze([
  'OPP-01',
  'OPP-02',
  'FAIL-01',
  'FAIL-11',
  'FAIL-12',
  'FAIL-13',
  'FAIL-14',
  'FAIL-15',
  'FAIL-16',
  'FAIL-17',
  'CRIT-02',
  'CRIT-03',
]);

// The three states of one manual item (F0 / D19).
export const CHECKLIST_VALUES = Object.freeze(['passed', 'bug', 'n/a']);

// The device of a bug (D21): mobile, desktop, or both.
export const BUG_DEVICES = Object.freeze(['M', 'D', 'M/D']);

// Order of the severity counts inside a multi-bug status (D21 example:
// "Critical (1), Failed (2), Opportunity (1)").
export const SEVERITY_ORDER = Object.freeze(['Critical', 'Failed', 'Opportunity']);

const DESCRIPTION_MAX = 200; // same cap as the summary texts (D3)

// The manual bugs of a checklist, in checklist order — the order the
// comment lines are registered in (F1: insertion order = comment order).
// The caller has already validated the checklist and the devices.
export function manualBugsFromChecklist(checklist, bugDevices = {}) {
  const bugs = [];
  for (const bugId of MANUAL_CHECKLIST) {
    if (checklist?.[bugId] !== 'bug') continue;
    const info = QA_BUGS[bugId];
    bugs.push({
      bugId,
      source: 'manual',
      device: bugDevices[bugId],
      type: info.type,
      severity: info.severity,
      description: info.name,
    });
  }
  return bugs;
}

// The tool's findings (D3) as bug rows, in summary order: every item with
// a BUGS.md id the catalog knows. Type and severity always come from the
// catalog — whatever the browser sent only labels the screen (F2). Items
// without a known id (bugId null: the H1 cases the Shadow classifies) are
// skipped: they have no row in the criteria table.
//
// `naFindings` (D26) holds the keys the Shadow marked as N/A
// ("<check>#<index>", already validated by the service against this very
// summary): those findings are left out exactly as if the tool had not
// reported them — no bug row, no count, no comment line.
export function toolBugsFromSummary(summary, naFindings = {}) {
  const bugs = [];
  for (const [checkName, check] of Object.entries(summary?.checks ?? {})) {
    const items = Array.isArray(check?.items) ? check.items : [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!item || typeof item !== 'object') continue;
      const info = QA_BUGS[item.bugId];
      if (!info) continue;
      if (Object.hasOwn(naFindings, `${checkName}#${index}`)) continue;
      bugs.push({
        bugId: item.bugId,
        source: 'tool',
        device: BUG_DEVICES.includes(item.device) ? item.device : 'D',
        type: info.type,
        severity: info.severity,
        description: String(item.text ?? info.name).slice(0, DESCRIPTION_MAX),
      });
    }
  }
  return bugs;
}

// D21 + D25 + D20 in one place:
//   - no bugs → status "Passed" and no comment at all;
//   - one bug → its own severity;
//   - several  → "Critical (1), Failed (2), Opportunity (1)", only the
//     severities that appeared, in that fixed order;
//   - the comment is one `Device / Type / Severity / Description` line per
//     bug, in the order the bugs were given.
export function statusAndCommentFromBugs(bugs) {
  const counts = { critical: 0, failed: 0, opportunity: 0 };
  for (const bug of bugs) {
    if (bug.severity === 'Critical') counts.critical += 1;
    else if (bug.severity === 'Failed') counts.failed += 1;
    else if (bug.severity === 'Opportunity') counts.opportunity += 1;
  }
  if (bugs.length === 0) {
    return { status: 'Passed', comment: null, counts };
  }
  const severityCount = { Critical: counts.critical, Failed: counts.failed, Opportunity: counts.opportunity };
  const status =
    bugs.length === 1
      ? bugs[0].severity
      : SEVERITY_ORDER.filter((severity) => severityCount[severity] > 0)
          .map((severity) => `${severity} (${severityCount[severity]})`)
          .join(', ');
  const comment = bugs
    .map((bug) => `${bug.device} / ${bug.type} / ${bug.severity} / ${bug.description}`)
    .join('\n');
  return { status, comment, counts };
}
