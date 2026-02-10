import { Router } from 'express';
import { linkReadingRun } from '../controllers/linkReadingController.js';
import { linkReadingAnchors, linkReadingStatuses } from '../controllers/linkReadingController.js';

const router = Router();

router.post('/run', linkReadingRun);
router.post('/anchors', linkReadingAnchors);
router.post('/statuses', linkReadingStatuses);

export default router;
