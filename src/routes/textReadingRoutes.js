import { Router } from 'express';
import { textReadingPreview } from '../controllers/textReadingController.js';

const router = Router();

router.post('/preview', textReadingPreview);

export default router;
