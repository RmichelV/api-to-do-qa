import { Router } from 'express';
import { textReadingPreview, textReadingCompare } from '../controllers/textReadingController.js';

const router = Router();

router.post('/preview', textReadingPreview);
router.post('/compare', textReadingCompare);

export default router;
