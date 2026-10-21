// Forced password change (design §5.5). While `must_change_password` is
// set, only the change-password flow may run: GET /api/auth/me,
// POST /api/auth/change-password, POST /api/auth/logout, the change-password
// page and the assets that page needs to render (stylesheet + its script).
// Every other API answers 403 password_change_required and every other page
// redirects to /change-password.html.
//
// Mounted app-wide after sessionMiddleware (design §6, step 7). Requests
// without a session pass through: denying them is requireAuth's job (T8).
const PASSWORD_CHANGE_PAGE = '/change-password.html';
const ALLOWED = new Set([
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout',
  `GET ${PASSWORD_CHANGE_PAGE}`,
  'GET /change-password.js',
  'GET /styles.css',
]);

export function requirePasswordChanged() {
  return function gatePasswordChange(req, res, next) {
    if (!req.user || !req.user.mustChangePassword) return next();
    if (ALLOWED.has(`${req.method} ${req.path}`)) return next();

    if (req.path.startsWith('/api/')) {
      return res.status(403).json({
        error: 'password_change_required',
        message: 'You must change your password before continuing.',
      });
    }
    return res.redirect(PASSWORD_CHANGE_PAGE);
  };
}
