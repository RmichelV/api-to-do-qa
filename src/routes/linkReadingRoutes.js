import { Router } from 'express';
import { linkReadingRun } from '../controllers/linkReadingController.js';
import { linkReadingAnchors } from '../controllers/linkReadingController.js';

const router = Router();

router.post('/run', linkReadingRun);
router.post('/anchors', linkReadingAnchors);

export default router;
