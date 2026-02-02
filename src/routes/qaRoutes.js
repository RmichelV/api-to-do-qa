import { Router } from 'express';
import { analyzeUrl } from '../controllers/qaController.js';

const router = Router();

router.post('/analyze', analyzeUrl);

export default router;