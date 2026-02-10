import { runLinkReading } from '../services/linkReadingService.js';
import { extractVisibleAnchors } from '../services/linkReadingService.js';

export const linkReadingRun = async (req, res) => {
	try {
		const { url, headless, pauseMs } = req.body || {};
		if (!url) {
			return res.status(400).type('text/plain').send('falta parámetro: url');
		}
		await runLinkReading(url, { headless, pauseMs });
		// No devolver contenido (por ahora): 204 No Content
		return res.status(204).send();
	} catch (err) {
		return res.status(500).type('text/plain').send('no se pudo ejecutar link-reading');
	}
};

export const linkReadingAnchors = async (req, res) => {
  const { url, headless, pauseMs } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const anchors = await extractVisibleAnchors(url, { headless, pauseMs });
    return res.status(200).json({ anchors });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Unknown error' });
  }
};
