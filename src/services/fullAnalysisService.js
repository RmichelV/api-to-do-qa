import { scrapePageContent, scrapePageContentMobile, scrapeH1DataMobile } from '../utils/scrapeUtils.js';
import { compareTextContent } from './textReadingService.js';
import { compareMobileTextContent } from './textReadingMobileService.js';
import { addHttpStatusesToAnchors, compareH1Snapshots } from './linkReadingService.js';

// Kept for cancel compatibility
export const activeBrowsersFull = new Set();

export const runFullAnalysis = async (url, coText = '') => {
  console.log(`[full-analysis] Start for ${url}`);

  const [desktop, mobileRawText] = await Promise.all([
    scrapePageContent(url),
    scrapePageContentMobile(url).catch(err => {
      console.warn('[full-analysis] Mobile scrape failed:', err?.message);
      return '';
    }),
  ]);

  let mobileH1Data = { h1Texts: [], srOnlyText: null };
  try {
    mobileH1Data = await scrapeH1DataMobile(url);
  } catch (err) {
    console.warn('[full-analysis] Mobile H1 scrape failed:', err?.message);
  }

  const h1Comparison = compareH1Snapshots(desktop, mobileH1Data);

  // Check HTTP statuses for the extracted links
  const desktopText = compareTextContent(desktop.rawText || '', coText);
  const mobileText = compareMobileTextContent(typeof mobileRawText === 'string' ? mobileRawText : '', coText);
  const anchorsWithStatus = await addHttpStatusesToAnchors(desktop.anchors || []);

  console.log(`[full-analysis] Complete for ${url}`);

  return {
    desktop: {
      cp: desktopText.cp,
      co: coText ? desktopText.co : null,
      ...(coText ? { result: desktopText.result, details: desktopText.details } : {}),
      anchors: anchorsWithStatus,
      h1Texts: desktop.h1Texts,
      srOnlyText: desktop.srOnlyText,
    },
    mobile: {
      cp: mobileText.cp,
      co: coText ? mobileText.co : null,
      ...(coText ? { result: mobileText.result, details: mobileText.details } : {}),
      h1Texts: mobileH1Data.h1Texts || [],
      srOnlyText: mobileH1Data.srOnlyText || null,
    },
    h1Comparison,
  };
};