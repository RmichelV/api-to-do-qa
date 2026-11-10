// /api/qa-records (PLAN F2, SPEC step 3). Mounted by app.js after
// requireAuth and requirePasswordChanged; the global originCheck (§6 step 5)
// already covers the state-changing method. Both qa_engineer and qa_shadow
// may save a QA (D5): no role guard here, the session is enough.
//
// F3, F5 and F7 add GET /mine, GET /:id, PATCH /:id and the Shadow routes
// to this same router.
import { Router } from 'express';
import { createQaRecordService } from '../services/qaRecordService.js';
import { createQaRecordController } from '../controllers/qaRecordController.js';

export default function qaRecordRoutes({ pool }) {
  const router = Router();
  const controller = createQaRecordController({
    service: createQaRecordService({ pool }),
  });

  router.post('/', (req, res, next) => controller.create(req, res).catch(next));

  return router;
}
