import { Router } from 'express';
// Actualizamos para usar la V2 (con lógica "Integrado/Incompleto")
import { analyzeContent } from '../controllers/qaControllerV2.js';

const router = Router();

router.post('/analyze', analyzeContent);

export default router;