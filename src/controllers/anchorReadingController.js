import { extractAndValidateAnchors } from '../services/anchorReadingService.js';

export const anchorReadingCheck = async (req, res) => {
	const { url, headless, pauseMs } = req.body || {};
	if (!url) {
		return res.status(400).json({ error: 'Missing url' });
	}
	try {
		const data = await extractAndValidateAnchors(url, { headless, pauseMs });
		return res.status(200).json(data);
	} catch (err) {
		return res.status(500).json({ error: err?.message || 'Unknown error' });
	}
};
