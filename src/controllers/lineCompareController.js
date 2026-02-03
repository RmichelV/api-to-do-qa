import { compareLines } from '../services/scrapeServiceV2.js';

export const compareLinesController = async (req, res) => {
  try {
    const { url, expectedText, remove } = req.body || {};
    if (!url || typeof expectedText !== 'string') {
      return res.status(400).json({ error: 'Faltan parámetros: url y expectedText' });
    }
    const selectors = Array.isArray(remove) ? remove : [];
    const result = await compareLines(url, expectedText, selectors);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: 'No se pudo comparar por líneas', detalles: error.message });
  }
};
