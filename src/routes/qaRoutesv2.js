
import { Router } from 'express';
import { analyzeContent } from '../controllers/qaControllerV2.js';

const router = Router();

router.post('/analyzeContent', analyzeContent);

export default router;