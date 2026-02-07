import { previewTextReading } from '../services/textReadingService.js';

export const textReadingPreview = async (req, res) => {
  try {
    const { url, headless, pauseMs } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'Falta parámetro: url' });
    }
    const result = await previewTextReading(url, { headless, pauseMs });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo ejecutar text-reading', detalles: err.message });
  }
};
