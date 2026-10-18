// Security headers (design §5.6). no-store on API responses so protected
// data is never kept in browser/proxy caches (full HTML policy lands with
// the protection model in T8).
export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
}
