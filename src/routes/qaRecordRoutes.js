// /api/qa-records (PLAN F2/F3/F5, SPEC steps 3, 4 and 6). Mounted by
// app.js after requireAuth and requirePasswordChanged; the global
// originCheck (§6 step 5) already covers the state-changing method.
//
// Two groups share this router:
//   - no role guard: POST /, GET /mine and PATCH /:id. Both qa_engineer
//     and qa_shadow save and list their own records (D5), and the owner
//     always comes from the session;
//   - requireRole('qa_shadow'): the F5 review routes — the pending queue,
//     the history, "Tomar", save progress and close (D6, D14). The guard
//     runs before any handler, so a qa_engineer typing the URL gets 403.
//
// `/mine` and `/history` are registered before any `/:id` segment so they
// never match as an id (F6 adds GET /:id after them).
import { Router } from 'express';
import { createQaRecordService } from '../services/qaRecordService.js';
import { createQaRecordController } from '../controllers/qaRecordController.js';
import { requireRole } from '../middleware/requireRole.js';

export default function qaRecordRoutes({ pool }) {
  const router = Router();
  const controller = createQaRecordController({
    service: createQaRecordService({ pool }),
  });
  const shadowOnly = requireRole('qa_shadow');

  // F5 (D14): the review queue and its Task ID search.
  router.get('/', shadowOnly, (req, res, next) => controller.listPending(req, res).catch(next));
  // F5 (D14): the QAs this Shadow reviewed and closed.
  router.get('/history', shadowOnly, (req, res, next) => controller.listHistory(req, res).catch(next));
  // F5 (D10): the three review actions, all atomic in SQL.
  router.post('/:id/take', shadowOnly, (req, res, next) => controller.take(req, res).catch(next));
  router.patch('/:id/review', shadowOnly, (req, res, next) => controller.saveReview(req, res).catch(next));
  router.post('/:id/close', shadowOnly, (req, res, next) => controller.closeReview(req, res).catch(next));

  // F2/F3, no role guard on purpose (D5).
  router.post('/', (req, res, next) => controller.create(req, res).catch(next));
  router.get('/mine', (req, res, next) => controller.listMine(req, res).catch(next));
  router.patch('/:id', (req, res, next) => controller.patch(req, res).catch(next));

  return router;
}
