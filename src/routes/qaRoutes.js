import { Router } from 'express';
// Actualizamos para usar la V2 (con lógica "Integrado/Incompleto")
import { analyzeContent } from '../controllers/qaControllerV2.js';
import { analyzeLinks } from '../controllers/linkController.js';

const router = Router();

router.post('/analyze', analyzeContent);
router.post('/analyze-links', analyzeLinks);

export default router;