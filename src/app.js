import express from 'express';
import path from 'node:path';
import textReadingRoutes from './routes/textReadingRoutes.js'
import textReadingMobileRoutes from './routes/textReadingMobileRoutes.js'
import linkReadingRoutes from './routes/linkReadingRoutes.js'
import anchorReadingRoutes from './routes/anchorReadingRoutes.js'
import imageReadingRoutes from './routes/imageReadingRoutes.js'
import fullAnalysisRoutes from './routes/fullAnalysisRoutes.js'
import authRoutes from './routes/authRoutes.js'
import { activeBrowsers } from './services/textReadingService.js'
import { activeBrowsersMobile } from './services/textReadingMobileService.js'
import { activeBrowsersLink } from './services/linkReadingService.js'
import { activeBrowsersAnchor } from './services/anchorReadingService.js'
import { activeBrowsersFull } from './services/fullAnalysisService.js'
import { securityHeaders } from './middleware/securityHeaders.js'
import { sessionMiddleware } from './middleware/sessionMiddleware.js'
import { publicAllowList } from './middleware/publicAllowList.js'
import { requireAuth } from './middleware/requireAuth.js'
import { requirePasswordChanged } from './middleware/requirePasswordChanged.js'
import { originCheck } from './middleware/originCheck.js'
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js'
import { PUBLIC_DIR } from './paths.js'

// Middleware order is the protection model of design §6. Default deny:
// only the public allow-list (step 4) answers anonymous requests; every
// route and static file mounted below requireAuth needs a session.
export function createApp({ config, pool }) {
  if (!config || !pool) {
    throw new Error('createApp requires config and pool: authentication is always on (T8).');
  }
  const app = express();

  // §6 step 1: trust proxy + security headers (HTTPS redirect arrives with T10).
  app.set('trust proxy', config.trustProxy ?? 0);
  app.use(securityHeaders);
  // §6 step 2
  app.use(express.json({ limit: '5mb' }));
  // §6 step 3: attaches req.user / req.session, never blocks.
  app.use(sessionMiddleware({ pool, secure: config.nodeEnv === 'production' }));
  // §6 step 4: the ONLY anonymous resources (login page + script, shared
  // CSS, healthz). Files served from src/paths.js, not from the cwd.
  app.use(publicAllowList());
  // §6 step 5: CSRF — every state-changing request, public ones included.
  app.use(originCheck(config.appOrigin));
  // §6 steps 4/5: POST /api/auth/login is public and origin-checked
  // ("POST /api/auth/login (+ originCheck)"). Logout joins it here (L25):
  // §7.1 idempotency — it revokes the session when the cookie is valid and
  // always answers 204 clearing the cookie, so it must not sit behind
  // requireAuth. Both answer before requireAuth but after originCheck.
  app.use('/api/auth', authRoutes({ pool, config, only: ['login', 'logout'] }));
  // §6 step 6: default deny. APIs → 401 unauthenticated; pages → 302 login.
  app.use(requireAuth());
  // §6 step 7: while must_change_password is set, only the change-password
  // flow may run (allow-list inside the middleware).
  app.use(requirePasswordChanged());
  // §6 step 8 minus logout (step 9, /api/admin/users, arrives with T9).
  app.use('/api/auth', authRoutes({ pool, config, only: ['me', 'change-password'] }));

  // §6 step 10: existing QA routers, contract unchanged (S12).
  app.use('/api/text-reading', textReadingRoutes);
  app.use('/api/text-reading-mobile', textReadingMobileRoutes);
  app.use('/api/link-reading', linkReadingRoutes);
  app.use('/api/anchor-reading', anchorReadingRoutes);
  app.use('/api/image-reading', imageReadingRoutes);
  app.use('/api/full-analysis', fullAnalysisRoutes);

  // Endpoint to cancel/stop all active processes
  app.post('/api/cancel', async (req, res) => {
    let closed = 0;
    const allSets = [activeBrowsers, activeBrowsersMobile, activeBrowsersLink, activeBrowsersAnchor, activeBrowsersFull];
    for (const set of allSets) {
      for (const browser of set) {
        try { await browser.close(); closed++; } catch {}
      }
      set.clear();
    }
    console.log(`[cancel] Closed ${closed} active browsers`);
    res.json({ cancelled: true, browsersClosed: closed });
  });

  // §6 step 11: protected static files and the index page.
  app.use(express.static(PUBLIC_DIR, { index: false }));
  app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  // §6 step 12
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
