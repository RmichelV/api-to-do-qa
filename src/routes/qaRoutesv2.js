
import { Router } from 'express';
import { analyzeContent } from '../controllers/qaControllerV2.js';
import { previewCleanText } from '../controllers/previewController.js';
import { compareLinesController } from '../controllers/lineCompareController.js';

const router = Router();

router.post('/analyzeContent', analyzeContent);
router.post('/preview', previewCleanText);
router.post('/compare-lines', compareLinesController);

export default router;