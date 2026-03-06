import { Router } from 'express';
import { textReadingMobilePreview, textReadingMobileCompare } from '../controllers/textReadingMobileController.js';

const router = Router();

router.post('/preview', textReadingMobilePreview);
router.post('/compare', textReadingMobileCompare);

export default router;
