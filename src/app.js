import express from 'express';
import textReadingRoutes from './routes/textReadingRoutes.js'
import textReadingMobileRoutes from './routes/textReadingMobileRoutes.js'
import linkReadingRoutes from './routes/linkReadingRoutes.js'
import anchorReadingRoutes from './routes/anchorReadingRoutes.js'
import fullAnalysisRoutes from './routes/fullAnalysisRoutes.js'
import authRoutes from './routes/authRoutes.js'
import { activeBrowsers } from './services/textReadingService.js'
import { activeBrowsersMobile } from './services/textReadingMobileService.js'
import { activeBrowsersLink } from './services/linkReadingService.js'
import { activeBrowsersAnchor } from './services/anchorReadingService.js'
import { activeBrowsersFull } from './services/fullAnalysisService.js'
import { securityHeaders } from './middleware/securityHeaders.js'
import { sessionMiddleware } from './middleware/sessionMiddleware.js'
import { requirePasswordChanged } from './middleware/requirePasswordChanged.js'
import { originCheck } from './middleware/originCheck.js'
import { errorHandler } from './middleware/errorHandler.js'

export function createApp({ config, pool } = {}) {
  const app = express();

  app.use(securityHeaders);
  app.use(express.json({ limit: '5mb' }));

  // Auth wiring (T5) only when config+pool are provided, so the QA smoke
  // tests keep calling createApp() bare (spec S12: QA endpoints unchanged).
  if (config && pool) {
    app.set('trust proxy', config.trustProxy ?? 0);
    app.use(sessionMiddleware({ pool, secure: config.nodeEnv === 'production' }));
    // §5.5: while must_change_password is set, only the change-password flow
    // runs; everything else answers 403 or redirects to the change page.
    app.use(requirePasswordChanged());
    // Origin check scoped to the auth routes for now; global application
    // lands with the full protection model in T8.
    app.use('/api/auth', originCheck(config.appOrigin), authRoutes({ pool, config }));
  }

  // Serve the 'public' folder as static files (HTML, CSS, JS).
  // public-auth/ is mounted first and stays public (design §7.4: /login.html
  // and /login.js); protecting public/ behind requireAuth is T8's job.
  app.use(express.static('public-auth'));
  app.use(express.static('public'));

  // Ruta antigua desactivada mientras arrancamos text-reading desde cero
  // app.use('/api/qa-v2', qaRoutesV2);
  app.use('/api/text-reading', textReadingRoutes);
  app.use('/api/text-reading-mobile', textReadingMobileRoutes);
  app.use('/api/link-reading', linkReadingRoutes);
  app.use('/api/anchor-reading', anchorReadingRoutes);
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

  app.use(errorHandler);

  return app;
}