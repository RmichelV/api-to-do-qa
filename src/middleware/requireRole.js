// Role gate for the admin users API (design §6 step 9, §7.2): only an
// active session whose role matches reaches the handlers below it.
//
// Mounted after requireAuth, so req.user normally exists; the missing-user
// branch keeps the middleware safe on its own (401 before 403).
export function requireRole(role) {
  return function denyWithoutRole(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: 'unauthenticated',
        message: 'Authentication required.',
      });
    }
    if (req.user.role !== role) {
      return res.status(403).json({
        error: 'forbidden',
        message: `The ${role} role is required.`,
      });
    }
    return next();
  };
}
