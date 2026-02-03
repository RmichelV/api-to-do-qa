import { extractCleanContent } from '../services/scrapeServiceV2.js';

export const previewCleanText = async (req, res) => {
  try {
    const { url, expectedText, remove } = req.body || {};

    if (!url) {
      return res.status(400).json({ error: 'Falta la url de la pagina a analizar' });
    }

    const selectors = Array.isArray(remove) ? remove : [];
    const expected = typeof expectedText === 'string' ? expectedText : '';

    const { cleaned_text } = await extractCleanContent(url, selectors);

    return res.status(200).json({
      url,
      expected_text: expected,
      page_clean_text: cleaned_text
    });
  } catch (error) {
    return res.status(500).json({
      error: 'No se pudo extraer el contenido limpio',
      detalles: error.message,
    });
  }
};
