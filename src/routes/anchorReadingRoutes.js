import { Router } from 'express';
import { anchorReadingCheck } from '../controllers/anchorReadingController.js';

const router = Router();

router.post('/check', anchorReadingCheck);

export default router;
