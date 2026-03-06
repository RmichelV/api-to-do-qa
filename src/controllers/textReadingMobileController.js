import { previewTextReadingMobile, compareTextReadingMobile } from '../services/textReadingMobileService.js';

export const textReadingMobilePreview = async (req, res) => {
  try {
    const { url, headless, pauseMs } = req.body || {};
    if (!url) {
      return res.status(400).type('text/plain').send('falta parámetro: url');
    }
    const cleanText = await previewTextReadingMobile(url, { headless, pauseMs });
    return res.status(200).type('text/plain').send(cleanText);
  } catch (err) {
    return res.status(500).type('text/plain').send('no se pudo ejecutar text-reading-mobile');
  }
};

export const textReadingMobileCompare = async (req, res) => {
  try {
    const { url, coText, headless, pauseMs } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'falta parámetro: url' });
    }
    const result = await compareTextReadingMobile(url, coText || '', { headless, pauseMs });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'no se pudo comparar text-reading-mobile' });
  }
};
