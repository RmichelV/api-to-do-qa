// /api/admin/users (design §7.2). Mounted by app.js at §6 step 9, behind
// requireAuth, requirePasswordChanged and requireRole('admin'); the global
// originCheck (step 5) already covers the state-changing methods.
import { Router } from 'express';
import { createAdminUserService } from '../services/adminUserService.js';
import { createAdminUserController } from '../controllers/adminUserController.js';

export default function adminUserRoutes({ pool }) {
  const router = Router();
  const controller = createAdminUserController({
    service: createAdminUserService({ pool }),
  });

  router.get('/', (req, res, next) => controller.list(req, res).catch(next));
  router.post('/', (req, res, next) => controller.create(req, res).catch(next));
  router.patch('/:id', (req, res, next) => controller.update(req, res).catch(next));
  router.post('/:id/reset-password', (req, res, next) =>
    controller.resetPassword(req, res).catch(next)
  );

  return router;
}
