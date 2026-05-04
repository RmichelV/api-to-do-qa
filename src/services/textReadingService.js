import { normalizeText } from '../utils/normalization.js';
import { scrapePageContent, compareLines } from '../utils/scrapeUtils.js';

// Kept for cancel compatibility (no browsers used anymore)
export const activeBrowsers = new Set();

/**
 * Extrae el texto editorial de la página y lo devuelve normalizado.
 */
export const previewTextReading = async (url) => {
  console.log(`[text-reading] Fetch+parse: ${url}`);
  const { rawText } = await scrapePageContent(url);
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n').filter(l => l.trim());
  console.log(`[text-reading] Done: ${lines.length} normalized lines`);
  return normalized;
};

/**
 * Extrae CP, normaliza CO y compara línea por línea.
 */
export const compareTextReading = async (url, coText) => {
  console.log(`[text-reading] Compare fetch+parse: ${url}`);
  const { rawText } = await scrapePageContent(url);
  const normalizedCP = normalizeText(rawText);
  const normalizedCO = normalizeText(coText || '');

  const cpLines = normalizedCP.split('\n').filter(l => l.trim());
  const coLines = normalizedCO.split('\n').filter(l => l.trim());
  console.log(`[text-reading] CP lines: ${cpLines.length}, CO lines: ${coLines.length}`);

  const { result, details } = compareLines(normalizedCP, normalizedCO);

  return {
    cp: { text: normalizedCP, lines: cpLines },
    co: { text: normalizedCO, lines: coLines },
    result,
    details,
  };
};