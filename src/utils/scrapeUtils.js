/**
 * scrapeUtils.js
 * Extrae y limpia el contenido de .ddc-wrapper usando fetch + cheerio.
 * Sin navegador — funciona con contenido SSR (server-side rendered).
 */

import { load } from 'cheerio';
import { buildBrowserHeaders } from './stealth.js';
import { normalizeText } from './normalization.js';

// Selectores a eliminar dentro del wrapper (inventario, mapas, formularios, UI)
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
 * Descarga el HTML de la URL y devuelve el objeto $ de cheerio + el html crudo.
 * Usa headers de navegador real para evitar bloqueos.
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
 * Extrae el texto limpio del wrapper, expansando acordeones/tabs mediante CSS-override.
 * Con cheerio trabajamos sobre HTML estático, así que los acordeones colapsados
 * simplemente los "abrimos" quitando los atributos que los ocultan.
 */
export const extractCleanText = ($, wrapper) => {
  // Eliminar elementos de inventario / UI
  CLEANUP_SELECTORS.forEach(sel => {
    try { wrapper.find(sel).remove(); } catch {}
  });

  // "Abrir" acordeones: eliminar atributos CSS que ocultan contenido
  wrapper.find('[aria-expanded="false"]').attr('aria-expanded', 'true');
  wrapper.find('[aria-hidden="true"]').attr('aria-hidden', 'false');
  wrapper.find('.collapse').removeClass('collapse');
  wrapper.find('.panel-collapse, .accordion-collapse').addClass('show in');

  // "Abrir" tabs: activar todos los paneles
  wrapper.find('.tab-pane').addClass('active show in');
  wrapper.find('[role="tab"]').attr('aria-selected', 'true');

  // Extraer texto: convertir block tags a saltos de línea
  // Usamos el HTML interno y lo parseamos manualmente para preservar estructura de líneas
  const blockTags = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'section', 'article', 'blockquote', 'tr', 'dt', 'dd', 'figcaption']);

  let text = '';
  const walk = (el) => {
    if (!el) return;
    if (el.type === 'text') {
      // Colapsar saltos de línea/tabulaciones dentro del nodo de texto
      // (son artefactos del HTML fuente, no separadores reales de contenido)
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
 * Descarga la página, aísla .ddc-wrapper, limpia y devuelve texto normalizado + metadatos.
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
    // Construir URL absoluta
    const absUrl = href.startsWith('http') ? href : new URL(href, url).href;
    anchors.push({ text, url: absUrl });
  });

  return { rawText, h1Texts, srOnlyText, anchors };
};

/**
 * Versión mobile: misma extracción pero con UA de iPhone.
 * El contenido SSR es idéntico (el servidor devuelve el mismo HTML).
 * Para diferencias reales de mobile habría que usar viewport/CSS,
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
 * Compara líneas normalizadas de CP contra CO.
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
