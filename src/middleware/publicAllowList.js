// Public allow-list (design §6, step 4). These are the ONLY resources an
// anonymous visitor may reach: the login screen and its script from
// public-auth/, the shared stylesheet, the health probe, and POST login.
// Everything else falls through to requireAuth (step 6). Files are served
// with absolute paths from src/paths.js, not from the cwd.
import express from 'express';
import path from 'node:path';
import { PUBLIC_DIR, PUBLIC_AUTH_DIR } from '../paths.js';

export function publicAllowList() {
  const router = express.Router();

  router.get('/login.html', (req, res) => {
    res.sendFile(path.join(PUBLIC_AUTH_DIR, 'login.html'));
  });

  router.get('/login.js', (req, res) => {
    res.sendFile(path.join(PUBLIC_AUTH_DIR, 'login.js'));
  });

  router.get('/styles.css', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'styles.css'));
  });

  router.get('/healthz', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  return router;
}
