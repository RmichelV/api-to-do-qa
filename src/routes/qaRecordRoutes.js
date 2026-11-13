// /api/qa-records (PLAN F2/F3, SPEC steps 3 and 4). Mounted by app.js after
// requireAuth and requirePasswordChanged; the global originCheck (§6 step 5)
// already covers the state-changing method. Both qa_engineer and qa_shadow
// may save a QA and list their own records (D5): no role guard here, the
// session is enough.
//
// F5 and F7 add GET /:id and the Shadow routes to this same router. `/mine`
// is registered before any `/:id` segment so it never matches as an id.
import { Router } from 'express';
import { createQaRecordService } from '../services/qaRecordService.js';
import { createQaRecordController } from '../controllers/qaRecordController.js';

export default function qaRecordRoutes({ pool }) {
  const router = Router();
  const controller = createQaRecordController({
    service: createQaRecordService({ pool }),
  });

  router.post('/', (req, res, next) => controller.create(req, res).catch(next));
  router.get('/mine', (req, res, next) => controller.listMine(req, res).catch(next));
  router.patch('/:id', (req, res, next) => controller.patch(req, res).catch(next));

  return router;
}
