import { Router } from 'express';
import { linkReadingRun } from '../controllers/linkReadingController.js';
import { linkReadingAnchors, linkReadingStatuses, linkReadingH1Check } from '../controllers/linkReadingController.js';

const router = Router();

router.post('/run', linkReadingRun);
router.post('/anchors', linkReadingAnchors);
router.post('/statuses', linkReadingStatuses);
router.post('/h1-check', linkReadingH1Check);

export default router;
