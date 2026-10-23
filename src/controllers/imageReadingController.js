import { readImages } from '../services/imageReadingService.js';

export const imageReadingScan = async (req, res) => {
  const { url } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const result = await readImages(url);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
};
