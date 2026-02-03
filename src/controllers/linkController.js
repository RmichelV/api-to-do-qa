import { checkLinks } from '../services/linkService.js';

export const analyzeLinks = async (req, res) => {
    try {
        const { url, remove = [] } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'Falta la URL' });
        }

        const report = await checkLinks(url, remove);
        res.json(report);
        
    } catch (error) {
        console.error("Error en linkController:", error);
        res.status(500).json({ error: error.message });
    }
};
