// Uniform JSON errors, no stack traces or SQL details to the client
// (design §7, §5.6).
// 404 for anything no route or static file answered (§6, step 12).
export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'not_found', message: 'Not found.' });
}

export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err?.isAppError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }

  // Malformed JSON body (express.json) and other client errors.
  if (err?.status === 400) {
    res.status(400).json({ error: 'validation_error', message: 'Malformed JSON body.' });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: 'internal_error', message: 'Internal server error.' });
}
