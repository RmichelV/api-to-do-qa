import { runLinkReading } from '../services/linkReadingService.js';
import { extractVisibleAnchors, fetchHttpStatuses, extractH1Data, extractAnchorsAndH1 } from '../services/linkReadingService.js';

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

export const linkReadingStatuses = async (req, res) => {
	const { urls, timeoutMs, concurrency } = req.body || {};
	if (!Array.isArray(urls) || urls.length === 0) {
		return res.status(400).json({ error: 'Missing urls' });
	}
	try {
		const statuses = await fetchHttpStatuses(urls, { timeoutMs, concurrency });
		return res.status(200).json({ statuses });
	} catch (err) {
		return res.status(500).json({ error: err?.message || 'Unknown error' });
	}
};

export const linkReadingH1Check = async (req, res) => {
	const { url, headless, pauseMs } = req.body || {};
	if (!url) {
		return res.status(400).json({ error: 'Missing url' });
	}
	try {
		const data = await extractH1Data(url, { headless, pauseMs });
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ error: err?.message || 'Unknown error' });
	}
};

// Endpoint combinado: extrae anchors + H1 en un solo navegador
export const linkReadingAnchorsAndH1 = async (req, res) => {
	const { url, headless } = req.body || {};
	if (!url) {
		return res.status(400).json({ error: 'Missing url' });
	}
	try {
		const data = await extractAnchorsAndH1(url, { headless });
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ error: err?.message || 'Unknown error' });
	}
};
