// POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me,
// POST /api/auth/change-password (design §7.1).
// Mounted under /api/auth by app.js together with the origin check.
import { Router } from 'express';
import { createAuthService } from '../services/authService.js';
import { createAuthController } from '../controllers/authController.js';

export default function authRoutes({ pool, config }) {
  const router = Router();
  const service = createAuthService({ pool, sessionDays: config.sessionDays });
  const controller = createAuthController({
    service,
    secure: config.nodeEnv === 'production',
  });

  router.post('/login', (req, res, next) => controller.login(req, res).catch(next));
  router.post('/logout', (req, res, next) => controller.logout(req, res).catch(next));
  router.get('/me', (req, res, next) => controller.me(req, res).catch(next));
  router.post('/change-password', (req, res, next) =>
    controller.changePassword(req, res).catch(next)
  );

  return router;
}
