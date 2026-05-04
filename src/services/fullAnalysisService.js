import { normalizeText } from '../utils/normalization.js';
import { scrapePageContent, scrapePageContentMobile, compareLines } from '../utils/scrapeUtils.js';
import { buildBrowserHeaders, randomDelay } from '../utils/stealth.js';

// Kept for cancel compatibility
export const activeBrowsersFull = new Set();

// HTTP statuses sin browser
const fetchStatuses = async (urls = []) => {
  if (!urls.length) return [];
  const timeoutMs = 12000;
  const concurrency = 5;
  const results = [];
  let index = 0;

  const runOne = async (u) => {
    await randomDelay(200, 600);
    const headers = buildBrowserHeaders(u);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: controller.signal, headers });
      clearTimeout(timer);
      return { url: u, status: res.status, ok: res.ok };
    } catch (e) {
      clearTimeout(timer);
      return { url: u, status: 0, ok: false, error: e?.cause?.code || e?.message || 'timeout' };
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (index < urls.length) {
      const current = urls[index++];
      try { results.push(await runOne(current)); }
      catch (err) { results.push({ url: current, status: 0, ok: false }); }
    }
  });
  await Promise.all(workers);
  const map = new Map(results.map(r => [r.url, r]));
  return urls.map(u => map.get(u) || { url: u, status: 0, ok: false });
};

export const runFullAnalysis = async (url, coText = '') => {
  console.log(`[full-analysis] Start for ${url}`);

  // Desktop y Mobile en paralelo (ambos son solo fetch, no browsers)
  const [desktop, mobileRawText] = await Promise.all([
    scrapePageContent(url),
    scrapePageContentMobile(url).catch(err => {
      console.warn('[full-analysis] Mobile scrape failed:', err?.message);
      return '';
    }),
  ]);

  // HTTP statuses para los links encontrados
  const anchors = desktop.anchors || [];
  const anchorUrls = anchors.map(a => a.url);
  const statuses = await fetchStatuses(anchorUrls);

  const statusMap = new Map(statuses.map(s => [s.url, s]));
  const anchorsWithStatus = anchors.map(a => ({
    ...a,
    status: statusMap.get(a.url)?.status ?? 0,
    statusOk: statusMap.get(a.url)?.ok ?? false,
  }));

  const normalizedCP = normalizeText(desktop.rawText || '');
  const normalizedCPMobile = normalizeText(typeof mobileRawText === 'string' ? mobileRawText : '');
  const normalizedCO = normalizeText(coText || '');

  const desktopCompare = coText ? compareLines(normalizedCP, normalizedCO) : null;
  const mobileCompare = coText ? compareLines(normalizedCPMobile, normalizedCO) : null;

  console.log(`[full-analysis] Complete for ${url}`);

  return {
    desktop: {
      cp: { text: normalizedCP, lines: normalizedCP.split('\n').filter(l => l.trim()) },
      co: coText ? { text: normalizedCO, lines: normalizedCO.split('\n').filter(l => l.trim()) } : null,
      ...(desktopCompare || {}),
      anchors: anchorsWithStatus,
      h1Texts: desktop.h1Texts,
      srOnlyText: desktop.srOnlyText,
    },
    mobile: {
      cp: { text: normalizedCPMobile, lines: normalizedCPMobile.split('\n').filter(l => l.trim()) },
      co: coText ? { text: normalizedCO, lines: normalizedCO.split('\n').filter(l => l.trim()) } : null,
      ...(mobileCompare || {}),
    },
  };
};