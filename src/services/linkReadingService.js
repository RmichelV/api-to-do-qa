import { buildBrowserHeaders, getRandomUserAgent, randomDelay } from '../utils/stealth.js';
import { scrapePageContent, scrapeH1DataMobile } from '../utils/scrapeUtils.js';

const normalizeTextForCompare = (value = '') => String(value).toLowerCase().replace(/\s+/g, ' ').trim();

export const compareH1Snapshots = (desktopData, mobileData) => {
  const desktopH1 = Array.isArray(desktopData?.h1Texts) ? desktopData.h1Texts : [];
  const mobileH1 = Array.isArray(mobileData?.h1Texts) ? mobileData.h1Texts : [];
  const desktopSrOnly = desktopData?.srOnlyText || null;
  const mobileSrOnly = mobileData?.srOnlyText || null;

  const sameH1 = JSON.stringify([...desktopH1].sort()) === JSON.stringify([...mobileH1].sort())
    && normalizeTextForCompare(desktopSrOnly || '') === normalizeTextForCompare(mobileSrOnly || '');

  return {
    same: sameH1,
    differs: !sameH1,
    desktop: {
      h1Texts: desktopH1,
      srOnlyText: desktopSrOnly,
    },
    mobile: {
      h1Texts: mobileH1,
      srOnlyText: mobileSrOnly,
    },
  };
};

// Kept for cancel compatibility
export const activeBrowsersLink = new Set();

// Extract visible anchors from .ddc-wrapper (without a browser)
export const extractVisibleAnchors = async (url) => {
  console.log(`[link-reading] Fetch+parse anchors: ${url}`);
  const { anchors } = await scrapePageContent(url);
  console.log(`[link-reading] Found ${anchors.length} links`);
  return anchors;
};

// Extract H1 and sr-only H1 content (without a browser)
export const extractH1Data = async (url) => {
  console.log(`[link-reading] Fetch+parse H1: ${url}`);
  const { h1Texts, srOnlyText } = await scrapePageContent(url);
  console.log(`[link-reading] H1s: ${h1Texts.length}, sr-only: ${srOnlyText ? 'yes' : 'no'}`);
  return { h1Texts, srOnlyText };
};

// Extract H1 and sr-only H1 with a mobile User-Agent without changing the existing mobile text scan
export const extractH1DataMobile = async (url) => {
  console.log(`[link-reading] Fetch+parse H1 (mobile): ${url}`);
  const { h1Texts, srOnlyText } = await scrapeH1DataMobile(url);
  console.log(`[link-reading] H1s (mobile): ${h1Texts.length}, sr-only: ${srOnlyText ? 'yes' : 'no'}`);
  return { h1Texts, srOnlyText };
};

export const compareH1Data = async (url) => {
  const desktopData = await scrapePageContent(url);
  const mobileData = await scrapeH1DataMobile(url);
  return compareH1Snapshots(desktopData, mobileData);
};

// Extract anchors + H1 in a single call (without a browser)
export const extractAnchorsAndH1 = async (url) => {
  console.log(`[link-reading] Fetch+parse anchors+H1: ${url}`);
  const desktopData = await scrapePageContent(url);
  const mobileData = await scrapeH1DataMobile(url);
  const comparison = compareH1Snapshots(desktopData, mobileData);
  console.log(`[link-reading] Links: ${desktopData.anchors.length}, H1s: ${desktopData.h1Texts.length}, mobileH1s: ${mobileData.h1Texts.length}`);
  return {
    anchors: desktopData.anchors,
    h1Texts: desktopData.h1Texts,
    srOnlyText: desktopData.srOnlyText,
    mobile: {
      h1Texts: mobileData.h1Texts,
      srOnlyText: mobileData.srOnlyText,
    },
    comparison,
  };
};

// Check the HTTP status of a list of URLs using stealth headers
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

export const addHttpStatusesToAnchors = async (anchors = [], options = {}) => {
  const statuses = await fetchHttpStatuses(anchors.map(anchor => anchor.url), options);
  const statusMap = new Map(statuses.map(status => [status.url, status]));

  return anchors.map(anchor => ({
    ...anchor,
    status: statusMap.get(anchor.url)?.status ?? 0,
    statusOk: statusMap.get(anchor.url)?.ok ?? false,
  }));
};

// runLinkReading kept for route compatibility (does nothing meaningful now)
export const runLinkReading = async (url) => {
  console.log(`[link-reading] runLinkReading (no-op with cheerio): ${url}`);
};