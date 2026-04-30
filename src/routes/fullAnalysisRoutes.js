import { Router } from 'express';
import { fullAnalysisHandler } from '../controllers/fullAnalysisController.js';

const router = Router();

router.post('/run', fullAnalysisHandler);

export default router;
