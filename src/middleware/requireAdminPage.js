// Admin-only pages (plan T9b, design §7.2). requireRole() answers JSON for
// the API; a page needs a readable answer instead, so this guard runs for the
// listed paths just before the static files are served.
//
// Mounted after requireAuth and requirePasswordChanged (§6 steps 6 and 7),
// so by the time it runs the session is valid and the forced-change gate has
// already redirected. The missing-user branch keeps it safe on its own:
// default deny, the same rule as requireRole.
const DEFAULT_MESSAGE = 'The admin role is required to open this page.';

function forbiddenPage(message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>403 Forbidden · QA API Tester</title>
  </head>
  <body>
    <h1>403 Forbidden</h1>
    <p>${message}</p>
    <p><a href="/">Back to the QA tool</a></p>
  </body>
</html>
`;
}

export function requireAdminPage(paths) {
  const pages = new Set(paths);
  return function denyWithoutAdminRole(req, res, next) {
    if (!pages.has(req.path)) return next();
    if (req.user?.role === 'admin') return next();
    return res.status(403).type('text/html').send(forbiddenPage(DEFAULT_MESSAGE));
  };
}
