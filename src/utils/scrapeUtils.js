/**
 * scrapeUtils.js
 * Extracts and cleans .ddc-wrapper content using fetch + cheerio.
 * No browser — works with SSR (server-side rendered) content.
 */

import { load } from 'cheerio';
import { buildBrowserHeaders } from './stealth.js';
import { normalizeText } from './normalization.js';

// Selectors to remove inside the wrapper (inventory, maps, forms, UI)
const CLEANUP_SELECTORS = [
  "[data-name^='inventory-search-results-page-filters-sort-']",
  "[data-name^='inventory-search-results-facets-']",
  '#inventory-results1-app-root', '#inventory-search1-app-root',
  '#inventory-filters1-app-root', '#inventory-facets1-app-root',
  '#kbb-leaddriver-search', "[data-name^='form-centered']",
  "[data-widget-name='contact-form']", "[data-name^='map-hours']",
  "[data-name='map-1']", "[data-widget-name='map-dynamic']",
  '.facetmulti.BLANK', '#compareForm', '.ws-inv-text-search',
  '.ws-inv-filters', '.ws-inv-facets', '.srp-wrapper-facets',
  'header', 'footer', '.global-header', '.global-footer',
  '.site-header', '.site-footer', '.ddc-header', '.ddc-footer',
  'nav', '.primary-nav', '.site-nav', '.breadcrumbs', '.bread-crumbs',
  '.topbar', '.sitewide-bar', '.cookie-banner', '#onetrust-banner-sdk',
  '[role="dialog"]', '.notification-banner', '.promo-banner',
  '[data-widget-name="chat"]', '.chat-widget', '.ws-hours', '.ws-social', '.ws-share',
  'script', 'style', 'noscript',
];

/**
 * Downloads the HTML from the URL and returns the cheerio $ object + raw html.
 * Uses real browser headers to avoid blocks.
 */
export const fetchPage = async (url) => {
  const headers = buildBrowserHeaders(url);
  const res = await fetch(url, {
    headers,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  return { $: load(html), html };
};

/**
 * Extracts clean text from the wrapper, expanding accordions/tabs via CSS override.
 * With cheerio we work on static HTML, so collapsed accordions
 * we simply "open" them by removing the attributes that hide them.
 */
export const extractCleanText = ($, wrapper) => {
  // Remove inventory / UI elements
  CLEANUP_SELECTORS.forEach(sel => {
    try { wrapper.find(sel).remove(); } catch {}
  });

  // "Open" accordions: remove CSS attributes that hide content
  wrapper.find('[aria-expanded="false"]').attr('aria-expanded', 'true');
  wrapper.find('[aria-hidden="true"]').attr('aria-hidden', 'false');
  wrapper.find('.collapse').removeClass('collapse');
  wrapper.find('.panel-collapse, .accordion-collapse').addClass('show in');

  // "Open" tabs: activate all panels
  wrapper.find('.tab-pane').addClass('active show in');
  wrapper.find('[role="tab"]').attr('aria-selected', 'true');

  // Extract text: convert block tags to line breaks
  // We use the inner HTML and parse it manually to preserve line structure
  const blockTags = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'section', 'article', 'blockquote', 'tr', 'dt', 'dd', 'figcaption']);

  let text = '';
  const walk = (el) => {
    if (!el) return;
    if (el.type === 'text') {
      // Collapse line breaks/tabs within text node
      // (they are artifacts of the source HTML, not real content separators)
      const t = (el.data || '').replace(/[\n\r\t]+/g, ' ');
      text += t;
      return;
    }
    if (el.type !== 'tag') return;
    const tag = el.name?.toLowerCase();
    if (tag === 'br') { text += '\n'; return; }
    if (el.children) el.children.forEach(walk);
    if (blockTags.has(tag)) text += '\n';
  };

  const root = wrapper[0];
  if (root && root.children) root.children.forEach(walk);

  return text;
};

/**
 * Downloads the page, isolates .ddc-wrapper, cleans and returns normalized text + metadata.
 * @param {string} url
 * @returns {{ rawText: string, h1Texts: string[], srOnlyText: string|null, anchors: Array }}
 */
export const scrapePageContent = async (url) => {
  const { $ } = await fetchPage(url);

  // H1 visible (fuera o dentro del wrapper, excluyendo sr-only)
  const h1Texts = [];
  $('h1').not('.sr-only').each((_, el) => {
    const t = $(el).text().trim();
    if (t) h1Texts.push(t);
  });
  const srOnlyEl = $('h1.sr-only').first();
  const srOnlyText = srOnlyEl.length ? srOnlyEl.text().trim() || null : null;

  const wrapper = $('.ddc-wrapper').first();
  if (!wrapper.length) throw new Error('.ddc-wrapper not found in page HTML');

  const rawText = extractCleanText($, wrapper);

  // Links dentro del wrapper (tras limpieza)
  const anchors = [];
  wrapper.find('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (!text || !href || href === '#') return;
    // Un link es relativo si NO tiene esquema (http/https/mailto/tel/etc.)
    const isRelative = !/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(href) && !href.startsWith('mailto:') && !href.startsWith('tel:');
    // Construir URL absoluta
    const absUrl = href.startsWith('http') ? href : new URL(href, url).href;
    anchors.push({ text, url: absUrl, originalHref: href, isRelative });
  });

  return { rawText, h1Texts, srOnlyText, anchors };
};

/**
 * Mobile version: same extraction but with iPhone UA.
 * SSR content is identical (server returns the same HTML).
 * For real mobile differences would need to use viewport/CSS,
 * pero a nivel de texto el contenido es el mismo.
 */
export const scrapePageContentMobile = async (url) => {
  const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const headers = {
    ...buildBrowserHeaders(url),
    'User-Agent': mobileUA,
  };
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();
  const $ = load(html);

  let wrapper = $('.ddc-wrapper').first();
  // Fallback: algunos servidores entregan HTML diferente para mobile
  if (!wrapper.length) {
    console.warn('[scrapeUtils] mobile: .ddc-wrapper not found, using body fallback');
    wrapper = $('body');
  }

  const rawText = extractCleanText($, wrapper);
  return rawText;
};

/**
 * Compares normalized CP lines against CO.
 */
export const compareLines = (normalizedCP, normalizedCO) => {
  const cpLines = normalizedCP.split('\n').filter(l => l.trim().length > 0);
  const coLines = normalizedCO.split('\n').filter(l => l.trim().length > 0);

  let lastFoundIndex = -1;
  const details = coLines.map((coLine) => {
    const cpIndex = cpLines.findIndex(l => l === coLine);
    if (cpIndex === -1) return { line: coLine, found: false, cpIndex: null, orderTag: 'missing' };
    const ordered = cpIndex > lastFoundIndex;
    if (ordered) lastFoundIndex = cpIndex;
    return { line: coLine, found: true, cpIndex, orderTag: ordered ? 'ordered' : 'out-of-order' };
  });

  const allFound = details.every(d => d.found);
  const allOrdered = details.filter(d => d.found).every(d => d.orderTag === 'ordered');
  return {
    result: { complete: allFound, ordered: allFound && allOrdered },
    details,
  };
};
