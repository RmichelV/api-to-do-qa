import { Router } from 'express';
import { imageReadingScan } from '../controllers/imageReadingController.js';

const router = Router();

router.post('/scan', imageReadingScan);

export default router;
