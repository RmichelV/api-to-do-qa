// CSRF defense (design §5.3): for state-changing requests the Origin (or
// the Referer as fallback) must match APP_ORIGIN, otherwise 403.
// SameSite=Lax on the session cookie already blocks cross-site POSTs; this
// is the server-side belt for older browsers and misconfigured clients.
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function originCheck(appOrigin) {
  return function originCheckMiddleware(req, res, next) {
    if (!STATE_CHANGING.has(req.method.toUpperCase())) return next();

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    let received = origin;
    if (!received && referer) {
      try {
        received = new URL(referer).origin;
      } catch {
        received = null;
      }
    }

    if (received && received === appOrigin) return next();
    res.status(403).json({ error: 'invalid_origin' });
  };
}
