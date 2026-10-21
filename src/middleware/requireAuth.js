// Default deny (design §6, step 6): every request below the public
// allow-list needs a session. API requests answer 401 unauthenticated;
// page requests are redirected to the login screen (302). Mounted once,
// after the public allow-list (step 4) and originCheck (step 5), and
// before requirePasswordChanged and every protected route.
export function requireAuth() {
  return function denyWithoutSession(req, res, next) {
    if (req.user) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({
        error: 'unauthenticated',
        message: 'Authentication required.',
      });
    }
    return res.redirect('/login.html');
  };
}
