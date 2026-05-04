import { buildBrowserHeaders, getRandomUserAgent, randomDelay } from '../utils/stealth.js';
import { scrapePageContent } from '../utils/scrapeUtils.js';

// Kept for cancel compatibility
export const activeBrowsersLink = new Set();

// Extrae anchors visibles de .ddc-wrapper (sin browser)
export const extractVisibleAnchors = async (url) => {
  console.log(`[link-reading] Fetch+parse anchors: ${url}`);
  const { anchors } = await scrapePageContent(url);
  console.log(`[link-reading] Found ${anchors.length} links`);
  return anchors;
};

// Extrae H1 y sr-only H1 (sin browser)
export const extractH1Data = async (url) => {
  console.log(`[link-reading] Fetch+parse H1: ${url}`);
  const { h1Texts, srOnlyText } = await scrapePageContent(url);
  console.log(`[link-reading] H1s: ${h1Texts.length}, sr-only: ${srOnlyText ? 'yes' : 'no'}`);
  return { h1Texts, srOnlyText };
};

// Extrae anchors + H1 en una sola llamada (sin browser)
export const extractAnchorsAndH1 = async (url) => {
  console.log(`[link-reading] Fetch+parse anchors+H1: ${url}`);
  const { anchors, h1Texts, srOnlyText } = await scrapePageContent(url);
  console.log(`[link-reading] Links: ${anchors.length}, H1s: ${h1Texts.length}`);
  return { anchors, h1Texts, srOnlyText };
};

// Verifica estado HTTP de una lista de URLs con headers stealth
export const fetchHttpStatuses = async (urls = [], options = {}) => {
  const timeoutMs = options.timeoutMs ?? 12000;
  const concurrency = options.concurrency ?? 5;
  const results = [];
  let index = 0;

  const runOne = async (u) => {
    await randomDelay(200, 800);
    const headers = buildBrowserHeaders(u);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: controller.signal, headers });
      clearTimeout(timer);
      return { url: u, status: res.status, ok: res.ok };
    } catch (e) {
      clearTimeout(timer);
      return { url: u, status: 0, ok: false, error: e?.cause?.code || e?.message || 'timeout_or_network' };
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, urls.length || 1) }, async () => {
    while (index < urls.length) {
      const current = urls[index++];
      try { results.push(await runOne(current)); }
      catch (err) { results.push({ url: current, status: 0, ok: false, error: err?.message || 'unknown' }); }
    }
  });
  await Promise.all(workers);
  const map = new Map(results.map(r => [r.url, r]));
  return urls.map(u => map.get(u) || { url: u, status: 0, ok: false });
};

// runLinkReading kept for route compatibility (does nothing meaningful now)
export const runLinkReading = async (url) => {
  console.log(`[link-reading] runLinkReading (no-op with cheerio): ${url}`);
};