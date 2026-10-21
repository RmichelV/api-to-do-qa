// Security headers (design §5.6). no-store on API responses and on HTML
// pages so protected content and its login redirects are never kept in
// browser/proxy caches (T8, correction L25).
export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  if (
    req.path.startsWith('/api/') ||
    (req.method === 'GET' && (req.path === '/' || req.path.endsWith('.html')))
  ) {
    res.set('Cache-Control', 'no-store');
  }
  next();
}
