import { runFullAnalysis } from '../services/fullAnalysisService.js';

export const fullAnalysisHandler = async (req, res) => {
  const { url, coText } = req.body || {};
  if (!url) {
    return res.status(400).json({ error: 'Missing url' });
  }
  try {
    const result = await runFullAnalysis(url, coText || '');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[full-analysis] Error:', err?.message);
    return res.status(500).json({ error: err?.message || 'Unknown error during full analysis' });
  }
};
