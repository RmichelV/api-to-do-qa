// POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me,
// POST /api/auth/change-password (design §7.1).
// Mounted under /api/auth by app.js. `only` selects the routes this router
// instance registers: login and logout are public (§6 step 4, "+ originCheck";
// logout placement per §7.1 idempotency, L25) while me and change-password
// sit behind requireAuth and requirePasswordChanged (§6 steps 7–8).
import { Router } from 'express';
import { createAuthService } from '../services/authService.js';
import { createAuthController } from '../controllers/authController.js';

export default function authRoutes({ pool, config, only }) {
  const router = Router();
  const service = createAuthService({ pool, sessionDays: config.sessionDays });
  const controller = createAuthController({
    service,
    secure: config.nodeEnv === 'production',
  });

  const wants = (name) => !only || only.includes(name);

  if (wants('login')) {
    router.post('/login', (req, res, next) => controller.login(req, res).catch(next));
  }
  if (wants('logout')) {
    router.post('/logout', (req, res, next) => controller.logout(req, res).catch(next));
  }
  if (wants('me')) {
    router.get('/me', (req, res, next) => controller.me(req, res).catch(next));
  }
  if (wants('change-password')) {
    router.post('/change-password', (req, res, next) =>
      controller.changePassword(req, res).catch(next)
    );
  }

  return router;
}
