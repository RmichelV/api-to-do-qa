import { previewTextReading, compareTextReading } from '../services/textReadingService.js';

export const textReadingPreview = async (req, res) => {
  try {
    const { url, headless, pauseMs } = req.body || {};
    if (!url) {
      return res.status(400).type('text/plain').send('missing parameter: url');
    }
    const cleanText = await previewTextReading(url, { headless, pauseMs });
    return res.status(200).type('text/plain').send(cleanText);
  } catch (err) {
    return res.status(500).type('text/plain').send('could not execute text-reading');
  }
};

export const textReadingCompare = async (req, res) => {
  try {
    const { url, coText, headless, pauseMs } = req.body || {};
    if (!url) {
      return res.status(400).json({ error: 'missing parameter: url' });
    }
    const result = await compareTextReading(url, coText || '', { headless, pauseMs });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'could not compare text-reading' });
  }
};
