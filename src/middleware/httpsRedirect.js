// Production HTTPS enforcement (design §5.6, plan T10).
//
// Caddy terminates TLS and forwards to the app with X-Forwarded-Proto; with
// TRUST_PROXY=1 (enforced by loadConfig in production) Express turns that
// header into req.secure, so the app can tell the original scheme apart from
// its own plain-HTTP socket.
//
// - Every production response carries Strict-Transport-Security (browsers
//   only honour it over HTTPS, so it is safe to always set it).
// - Plain HTTP is redirected with 308, which preserves method and body: a
//   POST /api/auth/login over HTTP must arrive as POST, never downgraded.
// - The redirect target is built from APP_ORIGIN (validated as an https://
//   URL by loadConfig in production), never from the request Host header,
//   which is client-controlled (plan T10, L35).
//
// Mounted in §6 step 1, before securityHeaders, exactly as the design lists it.
export function httpsRedirect(nodeEnv, appOrigin) {
  const enabled = nodeEnv === 'production';
  return function httpsRedirectMiddleware(req, res, next) {
    if (!enabled) return next();
    res.set('Strict-Transport-Security', 'max-age=31536000');
    if (req.secure) return next();
    // Without a configured origin there is no absolute URL to redirect to.
    if (!appOrigin) return next();
    res.redirect(308, new URL(req.originalUrl, appOrigin).toString());
  };
}
