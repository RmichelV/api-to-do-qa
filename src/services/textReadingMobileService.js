import { normalizeText } from '../utils/normalization.js';
import { scrapePageContentMobile, compareLines } from '../utils/scrapeUtils.js';

// Kept for cancel compatibility
export const activeBrowsersMobile = new Set();

export const extractEditorialRawMobile = async (url) => {
  console.log(`[text-reading-mobile] Fetch+parse: ${url}`);
  const rawText = await scrapePageContentMobile(url);
  console.log(`[text-reading-mobile] Done: ${rawText.length} chars`);
  return rawText;
};

export const previewTextReadingMobile = async (url) => {
  const rawText = await extractEditorialRawMobile(url);
  const normalized = normalizeText(rawText);
  const lines = normalized.split('\n').filter(l => l.trim());
  console.log(`[text-reading-mobile] Normalized: ${lines.length} lines`);
  return normalized;
};

export const compareTextReadingMobile = async (url, coText) => {
  const rawText = await extractEditorialRawMobile(url);
  const normalizedCP = normalizeText(rawText);
  const normalizedCO = normalizeText(coText || '');

  const cpLines = normalizedCP.split('\n').filter(l => l.trim());
  const coLines = normalizedCO.split('\n').filter(l => l.trim());
  console.log(`[text-reading-mobile] CP: ${cpLines.length} lines, CO: ${coLines.length} lines`);

  const { result, details } = compareLines(normalizedCP, normalizedCO);

  return {
    cp: { text: normalizedCP, lines: cpLines },
    co: { text: normalizedCO, lines: coLines },
    result,
    details,
  };
};